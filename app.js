const form = document.querySelector('#consultation-form');
const topicSelect = document.querySelector('#topic-select');
const questionField = document.querySelector('#question');
const characterCount = document.querySelector('#character-count');
const result = document.querySelector('#form-result');
const messageSubmitButton = document.querySelector('#message-submit');
const messageIntakeStatus = document.querySelector('#message-intake-status');
const studentNameField = document.querySelector('#student-name');
const studentEmailField = document.querySelector('#student-email');
const studentPhoneField = document.querySelector('#student-phone');
const studentGradeField = document.querySelector('#student-grade');
const apiBase = (window.ANOCO_CALL_API || '').replace(/\/$/, '');

for (const button of document.querySelectorAll('[data-topic]')) {
  button.addEventListener('click', () => {
    topicSelect.value = button.dataset.topic;
    document.querySelector('#consultation').scrollIntoView({ behavior: 'smooth' });
    topicSelect.focus({ preventScroll: true });
  });
}

questionField.addEventListener('input', () => {
  characterCount.textContent = `${questionField.value.length} / 1200`;
});

async function checkMessageService() {
  if (!apiBase) {
    messageSubmitButton.disabled = true;
    messageIntakeStatus.textContent = 'Message sending is unavailable on this preview.';
    return;
  }
  try {
    const response = await fetch(`${apiBase}/api/config`, { cache: 'no-store' });
    if (!response.ok) throw new Error('The message service could not be reached.');
    const config = await response.json();
    if (config.messageIntakeEnabled) {
      messageSubmitButton.disabled = false;
      messageSubmitButton.innerHTML = 'Send to a counselor <span aria-hidden="true">&#8594;</span>';
      messageIntakeStatus.textContent = `Only approved counselors can read messages. Messages are automatically deleted after ${config.messageRetentionHours} hours while a counselor is online. Replies are not guaranteed.`;
    } else {
      messageSubmitButton.disabled = true;
      messageIntakeStatus.textContent = 'Message sending is not enabled. Nothing you type is sent or saved.';
    }
  } catch {
    messageSubmitButton.disabled = true;
    messageIntakeStatus.textContent = 'The message service is unavailable. Nothing you type has been sent.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (!messageSubmitButton || messageSubmitButton.disabled || !apiBase) return;

  result.hidden = false;
  result.classList.remove('error');
  result.textContent = 'Sending your message...';
  messageSubmitButton.disabled = true;
  try {
    const response = await fetch(`${apiBase}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topicSelect.value,
        message: questionField.value,
        studentName: studentNameField.value,
        studentEmail: studentEmailField.value,
        studentPhone: studentPhoneField.value,
        studentGrade: studentGradeField.value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Your message could not be sent.');
    result.textContent = 'Your message was sent to the counselor inbox. It is not an emergency service, and a response is not guaranteed.';
    form.reset();
    characterCount.textContent = '0 / 1200';
  } catch (error) {
    result.classList.add('error');
    result.textContent = `${error.message} Your message was not confirmed as sent.`;
  } finally {
    await checkMessageService();
  }
});

void checkMessageService();

if (document.querySelector('#call-start')) {
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

async function callApi(path, options = {}) {
  const response = await fetch(`${callApiBase}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The call service is unavailable.');
  return payload;
}

async function refreshCallAvailability() {
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
        ? 'A counselor is online. Starting a call will ask for microphone access.'
        : 'Calls are available only while an approved counselor is online.';
  } catch {
    callStartButton.disabled = true;
    callStartButton.textContent = 'Calls unavailable';
    callStatus.textContent = 'The call service is not configured or is temporarily unavailable.';
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
  if (currentCallId && callApiBase) {
    try {
      await callApi(`/calls/${encodeURIComponent(currentCallId)}/end`, { method: 'POST' });
    } catch {
      message = 'Call ended on this device. The session will expire automatically.';
    }
  }
  callStatus.textContent = message;
  endingCall = false;
  await refreshCallAvailability();
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
    const call = await callApi('/calls', { method: 'POST' });
    createdCallId = call.callId;
    callId = call.callId;
    const { connectAudioRoom } = await import('./call-client.js');
    callRoom = await connectAudioRoom({
      serverUrl: call.serverUrl,
      token: call.token,
      audioRoot: remoteAudio,
      onParticipantsChanged(count) {
        if (count > 0) callStatus.textContent = 'A counselor is connected. Your call is audio-only.';
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
      ? 'Microphone access was not granted. You can allow it in browser settings and try again.'
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
  void refreshCallAvailability();
  availabilityTimer = window.setInterval(refreshCallAvailability, 10000);
} else {
  callStartButton.textContent = 'Calls not configured';
  callStatus.textContent = 'In-site calls will appear here after the secure call service is deployed and approved counselors are online.';
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
}
