import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const app = express();
const port = Number(process.env.PORT || 8787);
const workspaceDomain = (process.env.GOOGLE_WORKSPACE_DOMAIN || '').toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const counselorEmails = new Set((process.env.COUNSELOR_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean));
const liveKitUrl = process.env.LIVEKIT_URL || '';
const liveKitApiKey = process.env.LIVEKIT_API_KEY || '';
const liveKitApiSecret = process.env.LIVEKIT_API_SECRET || '';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const googleClient = new OAuth2Client(googleClientId);
const sessions = new Map();
const counselors = new Map();
const roomService = liveKitUrl && liveKitApiKey && liveKitApiSecret
  ? new RoomServiceClient(liveKitUrl, liveKitApiKey, liveKitApiSecret)
  : null;
const sessionLifetimeMs = 20 * 60 * 1000;
const closedSessionLifetimeMs = 5 * 60 * 1000;
const counselorPresenceLifetimeMs = 30 * 1000;

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '8kb' }));

const studentCallLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many call requests. Please wait before trying again.' },
});

function serviceReady() {
  return Boolean(
    workspaceDomain && googleClientId && counselorEmails.size > 0 && liveKitUrl && liveKitApiKey && liveKitApiSecret && roomService && allowedOrigins.length > 0,
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
    return next();
  } catch {
    return res.status(401).json({ error: 'Counselor sign-in could not be verified.' });
  }
}

function currentCounselorCount() {
  const cutoff = Date.now() - counselorPresenceLifetimeMs;
  for (const [id, lastSeen] of counselors) {
    if (lastSeen < cutoff) counselors.delete(id);
  }
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
    canPublishSources: ['microphone'],
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
  res.json({ configured: serviceReady(), googleClientId });
});

app.get('/api/availability', (_req, res) => {
  res.json({ available: serviceReady() && currentCounselorCount() > 0 });
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
  } catch {
    await roomService.deleteRoom(roomName).catch(() => {});
    return res.status(503).json({ error: 'A call could not be started. Please try again later.' });
  }
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

app.post('/api/staff/presence', requireCounselor, (_req, res) => {
  counselors.set(_req.counselorId, Date.now());
  return res.json({ available: true });
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
    session.status = 'active';
    session.counselorId = req.counselorId;
    return res.json({ serverUrl: liveKitUrl, token });
  } catch {
    session.status = 'waiting';
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
  for (const [id, session] of sessions) {
    findSession(id);
    if (session.closedAt && now - session.closedAt > closedSessionLifetimeMs) {
      sessions.delete(id);
    }
  }
}, 15_000).unref();

app.use((error, _req, res, _next) => {
  if (error.message === 'Origin is not allowed') {
    return res.status(403).json({ error: 'This site is not allowed to use the call service.' });
  }
  return res.status(500).json({ error: 'The call service encountered an error.' });
});

app.listen(port, () => {
  console.log(`AnoCo call service listening on port ${port}`);
});