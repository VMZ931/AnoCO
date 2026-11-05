const callApiBase = (window.ANOCO_CALL_API || '').replace(/\/$/, '');
const callStartButton = document.querySelector('#call-start');
const callStatus = document.querySelector('#call-status');
const callControls = document.querySelector('#call-controls');
const callMuteButton = document.querySelector('#call-mute');
const callEndButton = document.querySelector('#call-end');
const remoteAudio = document.querySelector('#remote-audio');
let callId = null;
let callRoom = null;
let callPollTimer = null;
let availabilityTimer = null;
let microphoneMuted = false;
let endingCall = false;

async function requestMicrophonePermission() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access requires the hosted HTTPS site. Do not use a local file copy.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

async function callApi(path, options = {}) {
  const response = await fetch(`${callApiBase}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The call service returned an invalid response.');
  }
  if (!response.ok) throw new Error(payload.error || 'The call service is unavailable.');
  return payload;
}

async function refreshAvailability() {
  if (!callApiBase || callId) return;
  try {
    const { configured, available } = await callApi('/availability');
    callStartButton.disabled = !configured || !available;
    callStartButton.textContent = !configured
      ? 'Calls not configured'
      : available ? 'Start an audio call' : 'No counselor online';
    callStatus.textContent = !configured
      ? 'The school call service still needs its approved settings.'
      : available
        ? 'An approved counselor is online. Starting a call will ask for microphone access.'
        : 'Calls are available only while an approved counselor is online.';
  } catch {
    callStartButton.disabled = true;
    callStartButton.textContent = 'Calls unavailable';
    callStatus.textContent = 'The call service could not be reached. Please try again later.';
  }
}

async function finishCall(message) {
  if (endingCall) return;
  endingCall = true;
  window.clearInterval(callPollTimer);
  callPollTimer = null;
  const currentCallId = callId;
  callId = null;
  const room = callRoom;
  callRoom = null;
  if (room) room.disconnect();
  remoteAudio.replaceChildren();
  callControls.hidden = true;
  callStartButton.hidden = false;
  callStartButton.disabled = true;
  callMuteButton.textContent = 'Mute microphone';
  microphoneMuted = false;
  if (currentCallId) {
    try {
      await callApi(`/calls/${encodeURIComponent(currentCallId)}/end`, { method: 'POST' });
    } catch {
      message = 'Audio disconnected on this device. The call session will expire automatically.';
    }
  }
  callStatus.textContent = message;
  endingCall = false;
  await refreshAvailability();
}

async function pollCallStatus() {
  if (!callId) return;
  try {
    const { status } = await callApi(`/calls/${encodeURIComponent(callId)}`);
    if (status === 'active' || status === 'joining') {
      callStatus.textContent = status === 'joining'
        ? 'A counselor is joining. Please stay on this page.'
        : 'A counselor joined. You are connected.';
    } else if (status === 'waiting') {
      callStatus.textContent = 'You are in a private waiting room. Please stay on this page.';
    } else {
      await finishCall('This call has ended. You can check availability and try again.');
    }
  } catch {
    await finishCall('The call connection was lost. Your audio has been disconnected.');
  }
}

async function startCall() {
  callStartButton.disabled = true;
  callStartButton.textContent = 'Starting call...';
  callStatus.textContent = 'Allow microphone access when your browser asks.';
  let createdCallId = null;

  try {
    await requestMicrophonePermission();
    const call = await callApi('/calls', { method: 'POST' });
    createdCallId = call.callId;
    callId = call.callId;
    const { connectAudioRoom } = await import('./call-client.js?v=2');
    callRoom = await connectAudioRoom({
      serverUrl: call.serverUrl,
      token: call.token,
      audioRoot: remoteAudio,
      onParticipantsChanged(count) {
        if (count > 0) callStatus.textContent = 'An approved counselor is connected. You are on an audio-only call.';
      },
      onDisconnected() {
        if (callId) void finishCall('The call connection ended.');
      },
    });
    callControls.hidden = false;
    callStartButton.hidden = true;
    callPollTimer = window.setInterval(pollCallStatus, 2000);
    await pollCallStatus();
  } catch (error) {
    if (createdCallId && !callId) callId = createdCallId;
    const message = error.name === 'NotAllowedError'
      ? 'Microphone access was not granted. Allow it in your browser settings to try again.'
      : error.name === 'NotFoundError'
        ? 'No microphone was found. Connect a microphone and try again.'
        : error.message || 'The call could not be started. Please try again.';
    await finishCall(message);
  }
}

callStartButton.addEventListener('click', startCall);
callEndButton.addEventListener('click', () => finishCall('You ended the call.'));
callMuteButton.addEventListener('click', async () => {
  if (!callRoom) return;
  microphoneMuted = !microphoneMuted;
  try {
    await callRoom.localParticipant.setMicrophoneEnabled(!microphoneMuted);
    callMuteButton.textContent = microphoneMuted ? 'Turn microphone on' : 'Mute microphone';
  } catch {
    microphoneMuted = !microphoneMuted;
    callStatus.textContent = 'The microphone setting could not be changed.';
  }
});

if (callApiBase) {
  void refreshAvailability();
  availabilityTimer = window.setInterval(refreshAvailability, 10000);
} else {
  callStartButton.textContent = 'Calls not configured';
  callStatus.textContent = 'The call service has not been configured for this site.';
}

window.addEventListener('pagehide', () => {
  window.clearInterval(callPollTimer);
  window.clearInterval(availabilityTimer);
  if (callId && callApiBase) {
    void fetch(`${callApiBase}/api/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST',
      keepalive: true,
    });
  }
  callRoom?.disconnect();
});
