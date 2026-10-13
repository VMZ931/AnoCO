const form = document.querySelector('#consultation-form');
const topicSelect = document.querySelector('#topic-select');
const questionField = document.querySelector('#question');
const characterCount = document.querySelector('#character-count');
const result = document.querySelector('#form-result');

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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  result.hidden = false;
  result.classList.remove('error');

  if (!form.reportValidity()) return;

  result.textContent = 'Thanks for writing this down. This is a demo, so your question was not sent or saved. Connect a secure service before collecting real submissions.';
});
