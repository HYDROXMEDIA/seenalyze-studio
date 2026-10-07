import { initI18n } from '../shared/i18n.js';

initI18n();

const api = window.recordingFacecam;
const video = document.getElementById('camera');
const STEP = 28;

// Finds the chosen camera by name ('default' is the system choice). Names are
// only readable after camera access, so access is asked for first. A camera
// that is not connected falls back to the default, as the recorder does.
async function cameraStream(name) {
  const constraints = { width: 1280, height: 720 };
  const fallback = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  if (name === 'default') return fallback;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const device = devices.find((entry) => entry.kind === 'videoinput' && entry.label === name);
  if (device === undefined || fallback.getVideoTracks()[0]?.getSettings().deviceId === device.deviceId) return fallback;
  fallback.getTracks().forEach((track) => track.stop());
  return navigator.mediaDevices.getUserMedia({ video: { ...constraints, deviceId: { exact: device.deviceId } }, audio: false });
}

async function start() {
  const config = await api.init();
  if (!config) return;
  video.srcObject = await cameraStream(config.camera);
}

function stop() {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
}

document.getElementById('smaller').addEventListener('click', () => api.resize(-STEP));
document.getElementById('larger').addEventListener('click', () => api.resize(STEP));

// Scrolling over the buttons also resizes; changes are sent once per frame.
let pending = 0;
window.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (pending === 0) {
    window.requestAnimationFrame(() => {
      api.resize(Math.round(pending));
      pending = 0;
    });
  }
  pending += -event.deltaY / 2;
}, { passive: false });

window.addEventListener('pagehide', stop);
start().catch((error) => {
  stop();
  api.error(error instanceof Error ? error.message : String(error));
});
