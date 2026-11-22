const apiBase = (window.ANOCO_CALL_API || '').replace(/\/$/, '');
const loginSection = document.querySelector('#staff-login');
const dashboard = document.querySelector('#staff-dashboard');
const signInButton = document.querySelector('#google-sign-in');
const statusText = document.querySelector('#staff-status');
const queueStatus = document.querySelector('#queue-status');
const queueList = document.querySelector('#call-queue');
const activeCallPanel = document.querySelector('#staff-active-call');
const activeCallStatus = document.querySelector('#active-call-status');
const remoteAudio = document.querySelector('#staff-remote-audio');
const counselorManagement = document.querySelector('#counselor-management');
const counselorForm = document.querySelector('#counselor-form');
const counselorEmail = document.querySelector('#counselor-email');
const counselorManagementStatus = document.querySelector('#counselor-management-status');
const counselorList = document.querySelector('#counselor-list');
const inboxStatus = document.querySelector('#inbox-status');
const inboxList = document.querySelector('#inbox-list');
const inboxRefreshButton = document.querySelector('#inbox-refresh');
const inboxRetention = document.querySelector('#inbox-retention');
let googleCredential = '';
let activeCallId = null;
let activeRoom = null;
let callServiceReady = false;
let messageIntakeEnabled = false;
let messageRetentionHours = null;
let queueTimer = null;
let presenceTimer = null;
let inboxTimer = null;
let muted = false;
let endingCall = false;

async function requestMicrophonePermission() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access requires the hosted HTTPS site. Do not use a local file copy.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${googleCredential}`,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The counselor service is unavailable.');
  return payload;
}

function setStaffStatus(message) {
  statusText.textContent = message;
}

async function refreshCounselors() {
  const { counselors } = await api('/staff/counselors');
  counselorList.replaceChildren();
  for (const email of counselors) {
    const item = document.createElement('li');
    item.textContent = email;
    counselorList.append(item);
  }
}

async function loadCounselorManagement() {
  const { canManageCounselors } = await api('/staff/session');
  counselorManagement.hidden = !canManageCounselors;
  if (canManageCounselors) await refreshCounselors();
}

async function sendPresence() {
  if (!callServiceReady) return;
  try {
    await api('/staff/presence', { method: 'POST' });
    queueStatus.textContent = activeCallId ? "You're online and speaking with a student." : "You're online for calls.";
  } catch (error) {
    queueStatus.textContent = error.message;
  }
}

async function refreshQueue() {
  if (!googleCredential) return;
  if (!callServiceReady) {
    queueStatus.textContent = 'The call queue is unavailable until the LiveKit call service is configured.';
    queueList.replaceChildren();
    const unavailable = document.createElement('li');
    unavailable.className = 'queue-empty';
    unavailable.textContent = 'Audio calls are not configured.';
    queueList.append(unavailable);
    return;
  }
  try {
    const { calls } = await api('/staff/calls');
    queueList.replaceChildren();
    if (calls.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'queue-empty';
      empty.textContent = 'No students are waiting right now.';
      queueList.append(empty);
      return;
    }

    for (const call of calls) {
      const item = document.createElement('li');
      item.className = 'queue-item';
      const waiting = document.createElement('span');
      waiting.textContent = `Waiting ${call.waitingSeconds} seconds`;
      const joinButton = document.createElement('button');
      joinButton.className = 'call-button';
      joinButton.type = 'button';
      joinButton.textContent = 'Answer call';
      joinButton.disabled = Boolean(activeCallId);
      joinButton.addEventListener('click', () => joinCall(call.callId));
      item.append(waiting, joinButton);
      queueList.append(item);
    }
  } catch (error) {
    queueStatus.textContent = error.message;
  }
}

async function refreshInbox() {
  if (!googleCredential || !messageIntakeEnabled) return;
  inboxRefreshButton.disabled = true;
  try {
    const { messages } = await api('/staff/messages');
    inboxList.replaceChildren();
    if (messages.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'queue-empty';
      empty.textContent = 'No messages are waiting for review.';
      inboxList.append(empty);
      inboxStatus.textContent = 'Inbox is up to date.';
      return;
    }

    for (const message of messages) {
      const item = document.createElement('li');
      item.className = 'inbox-item';
      const heading = document.createElement('div');
      heading.className = 'inbox-item-heading';
      const topic = document.createElement('strong');
      topic.textContent = message.topic;
      const submittedAt = document.createElement('time');
      submittedAt.dateTime = new Date(message.submittedAt).toISOString();
      submittedAt.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(message.submittedAt);
      const studentName = document.createElement('p');
      if (message.studentName) {
        studentName.className = 'inbox-student-name';
        studentName.textContent = `From: ${message.studentName}`;
      }
      const contactDetails = document.createElement('p');
      const contactParts = [];
      if (message.studentEmail) contactParts.push(`Email: ${message.studentEmail}`);
      if (message.studentPhone) contactParts.push(`Phone: ${message.studentPhone}`);
      if (message.studentGrade) contactParts.push(`Grade/section: ${message.studentGrade}`);
      if (contactParts.length) {
        contactDetails.className = 'inbox-contact-details';
        contactDetails.textContent = contactParts.join(' | ');
      }
      const content = document.createElement('p');
      content.textContent = message.message;
      const deleteButton = document.createElement('button');
      deleteButton.className = 'sign-out-button';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete message';
      deleteButton.addEventListener('click', () => deleteMessage(message.id, deleteButton));
      heading.append(topic, submittedAt);
      item.append(heading);
      if (message.studentName) item.append(studentName);
      if (contactParts.length) item.append(contactDetails);
      item.append(content, deleteButton);
      inboxList.append(item);
    }
    inboxStatus.textContent = `${messages.length} message${messages.length === 1 ? '' : 's'} in the inbox.`;
  } catch (error) {
    inboxStatus.textContent = `Inbox could not be refreshed: ${error.message}`;
  } finally {
    inboxRefreshButton.disabled = false;
  }
}

async function deleteMessage(messageId, button) {
  if (!window.confirm('Permanently delete this message from the inbox?')) return;
  button.disabled = true;
  try {
    await api(`/staff/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    inboxStatus.textContent = 'Message deleted.';
    await refreshInbox();
  } catch (error) {
    inboxStatus.textContent = `Message could not be deleted: ${error.message}`;
    button.disabled = false;
  }
}

async function joinCall(callId) {
  queueStatus.textContent = 'Connecting to the student...';
  try {
    await requestMicrophonePermission();
    const call = await api(`/staff/calls/${encodeURIComponent(callId)}/join`, { method: 'POST' });
    activeCallId = callId;
    activeCallStatus.textContent = 'Waiting for the student to connect...';
    activeCallPanel.hidden = false;
    const { connectAudioRoom } = await import('./call-client.js?v=2');
    activeRoom = await connectAudioRoom({
      serverUrl: call.serverUrl,
      token: call.token,
      audioRoot: remoteAudio,
      onParticipantsChanged(count) {
        activeCallStatus.textContent = count > 0
          ? "You're connected to a student. This call is audio-only."
          : 'Waiting for the student to connect...';
      },
      onDisconnected() {
        if (activeCallId) void endCall('The call connection ended.');
      },
    });
    await refreshQueue();
  } catch (error) {
    queueStatus.textContent = error.name === 'NotAllowedError'
      ? 'Microphone access was not granted. Allow it in browser settings to answer calls.'
      : error.name === 'NotFoundError'
        ? 'No microphone was found. Connect a microphone and try again.'
      : error.message;
    await endCall(queueStatus.textContent);
  }
}

async function endCall(message = 'The call has ended.') {
  if (endingCall) return;
  endingCall = true;
  const callId = activeCallId;
  activeCallId = null;
  const room = activeRoom;
  activeRoom = null;
  if (room) room.disconnect();
  remoteAudio.replaceChildren();
  activeCallPanel.hidden = true;
  document.querySelector('#staff-call-mute').textContent = 'Mute microphone';
  muted = false;
  if (callId) {
    try {
      await api(`/staff/calls/${encodeURIComponent(callId)}/end`, { method: 'POST' });
    } catch {
      message = 'The call ended on this device. Its room will expire automatically.';
    }
  }
  queueStatus.textContent = message;
  endingCall = false;
  await refreshQueue();
}

async function handleGoogleCredential(response) {
  googleCredential = response.credential;
  try {
    await api(callServiceReady ? '/staff/presence' : '/staff/session', {
      method: callServiceReady ? 'POST' : 'GET',
    });
    loginSection.hidden = true;
    dashboard.hidden = false;
    setStaffStatus('Counselor sign-in verified.');
    if (!callServiceReady) {
      queueStatus.textContent = 'The call queue is unavailable until the LiveKit call service is configured.';
    }
    if (!messageIntakeEnabled) {
      inboxStatus.textContent = 'Message intake is disabled. Configure the approved retention period to enable submissions.';
    } else {
      await refreshInbox();
      inboxTimer = window.setInterval(refreshInbox, 15000);
    }
    try {
      await loadCounselorManagement();
    } catch (error) {
      counselorManagementStatus.textContent = error.message;
    }
    await refreshQueue();
    queueTimer = window.setInterval(refreshQueue, 4000);
    presenceTimer = window.setInterval(sendPresence, 10000);
  } catch (error) {
    googleCredential = '';
    setStaffStatus(error.message);
  }
}

async function initializeConsole() {
  if (!apiBase) {
    setStaffStatus('The counselor call service is not configured.');
    signInButton.hidden = true;
    return;
  }

  try {
    const config = await fetch(`${apiBase}/api/config`).then((response) => response.json());
    if (!config.configured || !config.googleClientId) {
      setStaffStatus('Counselor sign-in is not configured. A school administrator must set up Google Workspace and approve counselor accounts on the call service.');
      signInButton.hidden = true;
      return;
    }
    callServiceReady = Boolean(config.callConfigured);
    messageIntakeEnabled = Boolean(config.messageIntakeEnabled);
    messageRetentionHours = config.messageRetentionHours;
    inboxRetention.textContent = messageIntakeEnabled
      ? `Messages automatically expire after ${messageRetentionHours} hours.`
      : 'Message retention must be configured before submissions can be enabled.';

    if (!window.google?.accounts?.id) {
      setStaffStatus('Google sign-in could not load. Refresh the page to try again.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential,
      auto_select: true,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(signInButton, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
    });
    setStaffStatus(callServiceReady
      ? 'Sign in using your approved school counselor account.'
      : 'Sign in to manage counselor access. Audio calls are not configured yet.');
  } catch {
    setStaffStatus('The call service could not be reached.');
    signInButton.hidden = true;
  }
}

counselorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!counselorForm.reportValidity()) return;

  const button = counselorForm.querySelector('button[type="submit"]');
  button.disabled = true;
  counselorManagementStatus.textContent = 'Adding counselor...';
  try {
    const { email } = await api('/staff/counselors', {
      method: 'POST',
      body: JSON.stringify({ email: counselorEmail.value }),
    });
    counselorForm.reset();
    counselorManagementStatus.textContent = `${email} can now sign in. This addition will be lost if the call service restarts.`;
    try {
      await refreshCounselors();
    } catch (error) {
      counselorManagementStatus.textContent = `${email} was added, but the counselor list could not be refreshed: ${error.message}`;
    }
  } catch (error) {
    counselorManagementStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

inboxRefreshButton.addEventListener('click', refreshInbox);

document.querySelector('#staff-call-end').addEventListener('click', () => endCall());
document.querySelector('#staff-call-mute').addEventListener('click', async (event) => {
  if (!activeRoom) return;
  muted = !muted;
  try {
    await activeRoom.localParticipant.setMicrophoneEnabled(!muted);
    event.currentTarget.textContent = muted ? 'Turn microphone on' : 'Mute microphone';
  } catch {
    muted = !muted;
    activeCallStatus.textContent = 'The microphone setting could not be changed.';
  }
});

document.querySelector('#staff-sign-out').addEventListener('click', async () => {
  await endCall('You signed out.');
  window.google?.accounts?.id?.disableAutoSelect();
  window.clearInterval(queueTimer);
  window.clearInterval(presenceTimer);
  window.clearInterval(inboxTimer);
  googleCredential = '';
  dashboard.hidden = true;
  counselorManagement.hidden = true;
  counselorList.replaceChildren();
  counselorManagementStatus.textContent = '';
  inboxList.replaceChildren();
  inboxStatus.textContent = 'Sign in to review messages.';
  loginSection.hidden = false;
  signInButton.replaceChildren();
  setStaffStatus('Sign in again when you are ready to receive calls.');
  void initializeConsole();
});

window.addEventListener('pagehide', () => {
  window.clearInterval(queueTimer);
  window.clearInterval(presenceTimer);
  window.clearInterval(inboxTimer);
  if (activeCallId && apiBase) {
    void fetch(`${apiBase}/api/staff/calls/${encodeURIComponent(activeCallId)}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleCredential}` },
      keepalive: true,
    });
  }
  activeRoom?.disconnect();
});

void initializeConsole();