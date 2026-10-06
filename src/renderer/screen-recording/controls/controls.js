import { initI18n, t } from '../shared/i18n.js';

initI18n();

const api = window.recordingControls;
const timeElement = document.getElementById('time');
const pauseButton = document.getElementById('pause');
const stopButton = document.getElementById('stop');

let state = { startedAt: Date.now(), pausedAt: null };

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function render() {
  const paused = state.pausedAt !== null;
  const now = paused ? state.pausedAt : Date.now();
  timeElement.textContent = formatTime(Math.max(0, Math.floor((now - state.startedAt) / 1000)));
  document.body.dataset.state = paused ? 'paused' : 'recording';
  const label = paused ? t('controls.resume') : t('controls.pause');
  pauseButton.setAttribute('aria-label', label);
  pauseButton.title = label;
}

pauseButton.addEventListener('click', () => api.togglePause());
stopButton.addEventListener('click', () => {
  stopButton.disabled = true;
  pauseButton.disabled = true;
  api.stop();
});

api.onState((next) => {
  state = next;
  render();
});

const initial = await api.init();
if (initial) state = initial;
render();
window.setInterval(render, 250);
