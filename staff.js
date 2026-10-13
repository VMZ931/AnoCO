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
let googleCredential = '';
let activeCallId = null;
let activeRoom = null;
let queueTimer = null;
let presenceTimer = null;
let muted = false;
let endingCall = false;

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

async function sendPresence() {
  try {
    await api('/staff/presence', { method: 'POST' });
    queueStatus.textContent = activeCallId ? "You're online and speaking with a student." : "You're online for calls.";
  } catch (error) {
    queueStatus.textContent = error.message;
  }
}

async function refreshQueue() {
  if (!googleCredential) return;
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

async function joinCall(callId) {
  queueStatus.textContent = 'Connecting to the student...';
  try {
    const call = await api(`/staff/calls/${encodeURIComponent(callId)}/join`, { method: 'POST' });
    activeCallId = callId;
    activeCallStatus.textContent = 'Waiting for the student to connect...';
    activeCallPanel.hidden = false;
    const { connectAudioRoom } = await import('./call-client.js');
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
      : error.message;
    await endCall();
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
    await api('/staff/presence', { method: 'POST' });
    loginSection.hidden = true;
    dashboard.hidden = false;
    setStaffStatus('Counselor sign-in verified.');
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
      setStaffStatus('Call service settings are incomplete.');
      signInButton.hidden = true;
      return;
    }

    if (!window.google?.accounts?.id) {
      setStaffStatus('Google sign-in could not load. Refresh the page to try again.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(signInButton, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
    });
    setStaffStatus('Sign in using your approved school counselor account.');
  } catch {
    setStaffStatus('The call service could not be reached.');
    signInButton.hidden = true;
  }
}

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
  window.clearInterval(queueTimer);
  window.clearInterval(presenceTimer);
  googleCredential = '';
  dashboard.hidden = true;
  loginSection.hidden = false;
  signInButton.replaceChildren();
  setStaffStatus('Sign in again when you are ready to receive calls.');
  void initializeConsole();
});

window.addEventListener('pagehide', () => {
  window.clearInterval(queueTimer);
  window.clearInterval(presenceTimer);
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