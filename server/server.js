import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const app = express();
const port = Number(process.env.PORT || 8787);
const workspaceDomain = (process.env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFromEmail = process.env.RESEND_FROM_EMAIL || '';
const counselorEmails = new Set((process.env.COUNSELOR_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean));
const counselorAdminEmails = new Set((process.env.COUNSELOR_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean));
for (const email of counselorAdminEmails) counselorEmails.add(email);
const liveKitUrl = process.env.LIVEKIT_URL || '';
const liveKitApiKey = process.env.LIVEKIT_API_KEY || '';
const liveKitApiSecret = process.env.LIVEKIT_API_SECRET || '';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const messageRetentionHours = Number(process.env.MESSAGE_RETENTION_HOURS);
const messageIntakeEnabled = process.env.MESSAGE_INTAKE_ENABLED === 'true'
  && Number.isInteger(messageRetentionHours)
  && messageRetentionHours >= 1
  && messageRetentionHours <= 720
  && counselorSignInReady();
const googleClient = new OAuth2Client(googleClientId);
const sessions = new Map();
const counselors = new Map();
const messages = new Map();
const messageTopics = new Set([
  'Stress & overwhelm',
  'Anxiety & worry',
  'Mood & motivation',
  'Friends & family',
  'Finding support',
]);
const roomService = liveKitUrl && liveKitApiKey && liveKitApiSecret
  ? new RoomServiceClient(liveKitUrl, liveKitApiKey, liveKitApiSecret)
  : null;
const sessionLifetimeMs = 20 * 60 * 1000;
const closedSessionLifetimeMs = 5 * 60 * 1000;
const counselorPresenceLifetimeMs = 30 * 1000;
let messageRetentionUpdatedAt = Date.now();
let counselorCoverageUntil = 0;

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Retry-After'],
}));
app.use(express.json({ limit: '8kb' }));

const studentCallLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: { error: 'Too many call requests. Please wait before trying again.' },
});
const studentMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  message: { error: 'Too many message submissions. Please wait before trying again.' },
});

function counselorSignInReady() {
  return Boolean(workspaceDomain && googleClientId && counselorEmails.size > 0 && allowedOrigins.length > 0);
}

function serviceReady() {
  return Boolean(
    counselorSignInReady() && liveKitUrl && liveKitApiKey && liveKitApiSecret && roomService,
  );
}

function requireService(res) {
  if (serviceReady()) return true;
  res.status(503).json({ error: 'The counselor call service is not configured yet.' });
  return false;
}

async function requireCounselor(req, res, next) {
  if (!googleClientId || !workspaceDomain) {
    return res.status(503).json({ error: 'Counselor sign-in is not configured.' });
  }

  const match = req.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Counselor sign-in is required.' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: match[1],
      audience: googleClientId,
    });
    const claims = ticket.getPayload();
    if (
      !claims?.email_verified
      || claims.hd?.toLowerCase() !== workspaceDomain
      || !counselorEmails.has(claims.email?.toLowerCase())
    ) {
      return res.status(403).json({ error: 'Use an approved school counselor account.' });
    }
    req.counselorId = claims.sub;
    req.counselorEmail = claims.email.toLowerCase();
    return next();
  } catch {
    return res.status(401).json({ error: 'Counselor sign-in could not be verified.' });
  }
}

function requireCounselorAdmin(req, res, next) {
  return requireCounselor(req, res, () => {
    if (!counselorAdminEmails.has(req.counselorEmail)) {
      return res.status(403).json({ error: 'Counselor administrator access is required.' });
    }
    return next();
  });
}

function currentCounselorCount() {
  const now = Date.now();
  pruneMessages(now);
  const cutoff = now - counselorPresenceLifetimeMs;
  for (const [id, presence] of counselors) {
    if (presence.lastSeen < cutoff) counselors.delete(id);
  }
  pruneMessages(now);
  return counselors.size;
}

function findSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now() && session.status !== 'ended') {
    session.status = 'expired';
    session.closedAt = Date.now();
    void roomService?.deleteRoom(session.roomName).catch(() => {});
  }
  return session;
}

async function createJoinToken({ identity, roomName, canPublish }) {
  const token = new AccessToken(liveKitApiKey, liveKitApiSecret, {
    identity,
    name: canPublish ? 'Student' : 'Counselor',
    ttl: '10m',
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE],
  });
  return token.toJwt();
}

async function closeSession(session, status = 'ended') {
  if (session.status === 'ended' || session.status === 'expired') return;
  session.status = status;
  session.closedAt = Date.now();
  await roomService?.deleteRoom(session.roomName).catch(() => {});
}

app.get('/api/health', (_req, res) => {
  res.json({ configured: serviceReady() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    configured: counselorSignInReady(),
    callConfigured: serviceReady(),
    messageIntakeEnabled,
    messageRetentionHours: messageIntakeEnabled ? messageRetentionHours : null,
    googleClientId,
  });
});

app.get('/api/availability', (_req, res) => {
  const configured = serviceReady();
  res.json({ configured, available: configured && currentCounselorCount() > 0 });
});

app.post('/api/calls', studentCallLimiter, async (_req, res) => {
  if (!requireService(res)) return;
  if (currentCounselorCount() < 1) {
    return res.status(409).json({ error: 'No counselor is available for a call right now.' });
  }

  const callId = randomUUID();
  const roomName = `anoco-${randomUUID()}`;
  const session = {
    callId,
    roomName,
    status: 'waiting',
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionLifetimeMs,
    closedAt: null,
  };

  try {
    await roomService.createRoom({ name: roomName, maxParticipants: 2, emptyTimeout: 60 });
    const token = await createJoinToken({
      identity: `student-${randomUUID()}`,
      roomName,
      canPublish: true,
    });
    sessions.set(callId, session);
    return res.status(201).json({ callId, serverUrl: liveKitUrl, token });
  } catch (error) {
    console.error('LiveKit call setup failed:', error instanceof Error ? error.message : 'Unknown error');
    await roomService.deleteRoom(roomName).catch(() => {});
    return res.status(503).json({ error: 'A call could not be started. Please try again later.' });
  }
});

app.post('/api/messages', studentMessageLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!messageIntakeEnabled) {
    return res.status(503).json({ error: 'Message submissions are not enabled.' });
  }
  pruneMessages();

  const topic = typeof req.body?.topic === 'string' ? req.body.topic : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const studentName = typeof req.body?.studentName === 'string'
    ? req.body.studentName.trim().slice(0, 80)
    : '';
  const studentEmail = typeof req.body?.studentEmail === 'string'
    ? req.body.studentEmail.trim().slice(0, 254)
    : '';
  const studentPhone = typeof req.body?.studentPhone === 'string'
    ? req.body.studentPhone.trim().slice(0, 40)
    : '';
  const studentGrade = typeof req.body?.studentGrade === 'string'
    ? req.body.studentGrade.trim().slice(0, 40)
    : '';
  if (studentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
  }
  if (!messageTopics.has(topic) || message.length < 1 || message.length > 1200) {
    return res.status(400).json({ error: 'Choose a topic and enter a message of up to 1200 characters.' });
  }
  if (messages.size >= 500) {
    return res.status(503).json({ error: 'The counselor inbox is full. Please try again later or use the call page.' });
  }

  const submission = {
    id: randomUUID(),
    topic,
    message,
    studentName,
    studentEmail,
    studentPhone,
    studentGrade,
    submittedAt: Date.now(),
    retainedOnlineMs: 0,
  };
  messages.set(submission.id, submission);
  return res.status(201).json({ submitted: true });
});

app.get('/api/calls/:callId', (req, res) => {
  const session = findSession(req.params.callId);
  if (!session) return res.status(404).json({ error: 'Call session not found.' });
  return res.json({ status: session.status });
});

app.post('/api/calls/:callId/end', async (req, res) => {
  const session = findSession(req.params.callId);
  if (!session) return res.status(404).json({ error: 'Call session not found.' });
  await closeSession(session);
  return res.json({ status: session.status });
});

app.post('/api/staff/presence', requireCounselor, (req, res) => {
  const now = Date.now();
  pruneMessages(now);
  counselors.set(req.counselorId, { email: req.counselorEmail, lastSeen: now });
  pruneMessages(now);
  return res.json({ available: true });
});

app.post('/api/staff/presence/end', requireCounselor, (req, res) => {
  const now = Date.now();
  pruneMessages(now);
  counselors.delete(req.counselorId);
  currentCounselorCount();
  pruneMessages(now);
  return res.json({ available: false });
});

app.get('/api/staff/session', requireCounselor, (req, res) => {
  return res.json({ canManageCounselors: counselorAdminEmails.has(req.counselorEmail) });
});

app.get('/api/staff/messages', requireCounselor, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  pruneMessages();
  return res.json({
    messages: [...messages.values()].sort((left, right) => left.submittedAt - right.submittedAt),
  });
});

app.delete('/api/staff/messages/:messageId', requireCounselor, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!messages.delete(req.params.messageId)) {
    return res.status(404).json({ error: 'That message is no longer in the inbox.' });
  }
  return res.json({ deleted: true });
});

app.post('/api/staff/messages/:messageId/reply', requireCounselor, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const message = messages.get(req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: 'That message is no longer in the inbox.' });
  }
  if (!message.studentEmail) {
    return res.status(400).json({ error: 'This message does not include a student email address.' });
  }
  if (!resendApiKey || !resendFromEmail) {
    return res.status(503).json({ error: 'Server email replies are not configured.' });
  }

  const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
  if (reply.length < 1 || reply.length > 2000) {
    return res.status(400).json({ error: 'Enter a reply of 1 to 2000 characters.' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [message.studentEmail],
        subject: `Re: ${message.topic}`,
        text: `${reply}\n\n---\nAnoCo student support`,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      console.error('Server email reply failed:', payload?.message || `HTTP ${response.status}`);
      return res.status(502).json({ error: 'The reply could not be sent. Please try again.' });
    }
    return res.json({ replied: true });
  } catch (error) {
    console.error('Server email reply failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(502).json({ error: 'The reply could not be sent. Please try again.' });
  }
});

app.get('/api/staff/counselors', requireCounselor, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  currentCounselorCount();
  const onlineEmails = new Set([...counselors.values()].map((presence) => presence.email));
  const roster = [...counselorEmails]
    .sort()
    .map((email) => ({ email, online: onlineEmails.has(email) }));
  return res.json({ counselors: roster });
});

app.post('/api/staff/counselors', requireCounselorAdmin, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith(`@${workspaceDomain}`)) {
    return res.status(400).json({ error: `Enter a valid email address in the ${workspaceDomain} school domain.` });
  }
  if (counselorEmails.has(email)) {
    return res.status(409).json({ error: 'That counselor is already approved.' });
  }
  counselorEmails.add(email);
  return res.status(201).json({ email });
});

app.get('/api/staff/calls', requireCounselor, (_req, res) => {
  const queue = [...sessions.values()]
    .filter((session) => findSession(session.callId)?.status === 'waiting')
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((session) => ({
      callId: session.callId,
      waitingSeconds: Math.floor((Date.now() - session.createdAt) / 1000),
    }));
  return res.json({ calls: queue });
});

app.post('/api/staff/calls/:callId/join', requireCounselor, async (req, res) => {
  if (!requireService(res)) return;
  const counselorIsBusy = [...sessions.values()].some((candidate) =>
    ['joining', 'active'].includes(candidate.status) && candidate.counselorId === req.counselorId);
  if (counselorIsBusy) {
    return res.status(409).json({ error: 'End your current call before answering another student.' });
  }
  const session = findSession(req.params.callId);
  if (!session || session.status !== 'waiting') {
    return res.status(404).json({ error: 'That call is no longer waiting.' });
  }

  session.status = 'joining';
  try {
    const token = await createJoinToken({
      identity: `counselor-${randomUUID()}`,
      roomName: session.roomName,
      canPublish: true,
    });
    if (session.status !== 'joining') {
      return res.status(409).json({ error: 'That call has already ended.' });
    }
    session.status = 'active';
    session.counselorId = req.counselorId;
    return res.json({ serverUrl: liveKitUrl, token });
  } catch (error) {
    console.error('LiveKit counselor join failed:', error instanceof Error ? error.message : 'Unknown error');
    if (session.status === 'joining') session.status = 'waiting';
    return res.status(503).json({ error: 'The call could not be joined.' });
  }
});

app.post('/api/staff/calls/:callId/end', requireCounselor, async (req, res) => {
  const session = findSession(req.params.callId);
  if (!session) return res.status(404).json({ error: 'Call session not found.' });
  await closeSession(session);
  return res.json({ status: session.status });
});

setInterval(() => {
  const now = Date.now();
  currentCounselorCount();
  pruneMessages(now);
  for (const [id, session] of sessions) {
    findSession(id);
    if (session.closedAt && now - session.closedAt > closedSessionLifetimeMs) {
      sessions.delete(id);
    }
  }
}, 15_000).unref();

function pruneMessages(now = Date.now()) {
  if (!messageIntakeEnabled) return;
  advanceMessageRetention(now);
  const retentionMs = messageRetentionHours * 60 * 60 * 1000;
  for (const [id, message] of messages) {
    if (message.retainedOnlineMs >= retentionMs) messages.delete(id);
  }
}

function advanceMessageRetention(now) {
  const coveredUntil = Math.min(now, counselorCoverageUntil);
  if (coveredUntil > messageRetentionUpdatedAt) {
    for (const message of messages.values()) {
      const coveredFrom = Math.max(messageRetentionUpdatedAt, message.submittedAt);
      message.retainedOnlineMs += Math.max(0, coveredUntil - coveredFrom);
    }
  }
  messageRetentionUpdatedAt = now;
  counselorCoverageUntil = 0;
  for (const { lastSeen } of counselors.values()) {
    counselorCoverageUntil = Math.max(
      counselorCoverageUntil,
      lastSeen + counselorPresenceLifetimeMs,
    );
  }
}

app.use((error, _req, res, _next) => {
  if (error.message === 'Origin is not allowed') {
    return res.status(403).json({ error: 'This site is not allowed to use the call service.' });
  }
  return res.status(500).json({ error: 'The call service encountered an error.' });
});

app.listen(port, () => {
  console.log(`AnoCo call service listening on port ${port}`);
});