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
const threadPanel = document.querySelector('#student-thread');
const threadTitle = document.querySelector('#student-thread-title');
const threadTopic = document.querySelector('#student-thread-topic');
const threadLink = document.querySelector('#student-thread-link');
const threadMessages = document.querySelector('#student-thread-messages');
const threadReplyForm = document.querySelector('#student-thread-reply');
const threadReplyField = document.querySelector('#student-thread-reply-text');
const threadReplyButton = document.querySelector('#student-thread-reply-submit');
const threadStatus = document.querySelector('#student-thread-status');
const apiBase = (window.ANOCO_CALL_API || '').replace(/\/$/, '');
let studentThreadToken = '';
let threadRefreshTimer = null;

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

function addConversationMessage(entry) {
  const item = document.createElement('li');
  item.className = `student-thread-message ${entry.sender === 'counselor' ? 'from-counselor' : 'from-student'}`;
  const sender = document.createElement('strong');
  sender.textContent = entry.sender === 'counselor' ? 'Counselor' : 'You';
  const timestamp = document.createElement('time');
  const date = new Date(entry.sentAt);
  if (!Number.isNaN(date.getTime())) {
    timestamp.dateTime = date.toISOString();
    timestamp.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
  const message = document.createElement('p');
  message.textContent = entry.message;
  item.append(sender, timestamp, message);
  threadMessages.append(item);
}

async function refreshStudentThread({ showStatus = false } = {}) {
  if (!studentThreadToken) return;
  if (!apiBase) {
    threadStatus.textContent = 'The message service is unavailable. Your reply has not been sent.';
    return;
  }
  try {
    const response = await fetch(`${apiBase}/api/student/thread`, {
      headers: { Authorization: `Bearer ${studentThreadToken}` },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'This private conversation could not be loaded.');
    threadTopic.textContent = payload.topic;
    threadMessages.replaceChildren();
    for (const entry of payload.conversation) addConversationMessage(entry);
    if (showStatus) threadStatus.textContent = 'Conversation loaded. Replies are not monitored as an emergency service.';
  } catch (error) {
    threadStatus.textContent = error.message;
    window.clearInterval(threadRefreshTimer);
    threadRefreshTimer = null;
  }
}

async function openStudentThread(token, { updateHash = false } = {}) {
  studentThreadToken = token;
  threadPanel.hidden = false;
  threadMessages.replaceChildren();
  threadTitle.textContent = 'Your counselor conversation';
  threadStatus.textContent = 'Loading your private conversation...';
  window.clearInterval(threadRefreshTimer);
  threadRefreshTimer = null;
  showPrivateThreadLink(token);
  if (updateHash) {
    form.hidden = true;
    history.replaceState(null, '', `${location.pathname}${location.search}#thread=${encodeURIComponent(token)}`);
  }
  await refreshStudentThread({ showStatus: true });
  if (threadMessages.childElementCount > 0) {
    form.hidden = true;
    threadPanel.scrollIntoView({ block: 'start' });
    threadTitle.focus({ preventScroll: true });
    window.clearInterval(threadRefreshTimer);
    threadRefreshTimer = window.setInterval(() => {
      if (!document.hidden) void refreshStudentThread();
    }, 15000);
  }
}

function showPrivateThreadLink(token) {
  const threadUrl = `${location.origin}${location.pathname}${location.search}#thread=${encodeURIComponent(token)}`;
  const link = document.createElement('a');
  link.href = threadUrl;
  link.textContent = 'Open your private conversation link';
  link.className = 'thread-link';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'thread-copy-button';
  copyButton.textContent = 'Copy private link';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(threadUrl);
      copyButton.textContent = 'Link copied';
    } catch {
      copyButton.textContent = 'Copy unavailable — use the link above';
    }
  });
  threadLink.replaceChildren(
    document.createTextNode('Save this private link so you can return to the conversation: '),
    link,
    document.createTextNode(' '),
    copyButton,
  );
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
    if (typeof payload.threadToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.threadToken)) {
      throw new Error('The message service did not return a valid private conversation link.');
    }
    result.textContent = 'Your message was sent. Your conversation is not an emergency service, and a response is not guaranteed.';
    form.reset();
    characterCount.textContent = '0 / 1200';
    await openStudentThread(payload.threadToken, { updateHash: true });
  } catch (error) {
    result.classList.add('error');
    result.textContent = `${error.message} Your message was not confirmed as sent.`;
  } finally {
    await checkMessageService();
  }
});

threadReplyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!threadReplyForm.reportValidity() || !studentThreadToken) return;
  if (!apiBase) {
    threadStatus.textContent = 'The message service is unavailable. Your reply has not been sent.';
    return;
  }

  threadReplyButton.disabled = true;
  threadStatus.textContent = 'Sending your reply...';
  try {
    const response = await fetch(`${apiBase}/api/student/replies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentThreadToken}`,
      },
      body: JSON.stringify({ reply: threadReplyField.value }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Your reply could not be sent.');
    threadReplyField.value = '';
    await refreshStudentThread();
    threadStatus.textContent = 'Your reply was sent. Counselor replies will appear here.';
  } catch (error) {
    threadStatus.textContent = error.message;
  } finally {
    threadReplyButton.disabled = false;
  }
});

const existingThreadToken = new URLSearchParams(location.hash.slice(1)).get('thread');
if (existingThreadToken && /^[A-Za-z0-9_-]{43}$/.test(existingThreadToken)) {
  void openStudentThread(existingThreadToken);
}

window.addEventListener('pagehide', () => window.clearInterval(threadRefreshTimer));

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
