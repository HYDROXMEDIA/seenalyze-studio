import { t, intlLocale, initI18n, onLocaleChange } from '../shared/i18n.js';

// A full-screen overlay with fixed geometry: set the language only, never the direction.
initI18n();

const api = window.recordingCapture;

// The last mode, area and options are kept on this device so the next
// recording starts where the previous one ended.
const STORAGE_KEY = 'studio.recording-picker.v1';
const MODES = ['window', 'area', 'screen'];
const MIN_SELECTION = 4;

const body = document.body;
const selectionElement = document.getElementById('selection');
const selectionSize = document.getElementById('selection-size');
const highlight = document.getElementById('target-highlight');
const highlightLabel = document.getElementById('target-label');
const crosshairHint = document.getElementById('crosshair-hint');
const toolbar = document.getElementById('toolbar');
const toolbarHint = document.getElementById('toolbar-hint');
const modeButtons = Array.from(document.querySelectorAll('.mode-button'));
const captureButton = document.getElementById('capture-button');
const formatSelect = document.getElementById('record-format');
const resolutionSelect = document.getElementById('record-resolution');
const fpsSelect = document.getElementById('record-fps');
const micSelect = document.getElementById('record-mic');
const cameraSelect = document.getElementById('record-camera');
const folderButton = document.getElementById('record-folder');
const moreButton = document.getElementById('record-more');
const deviceMenu = document.getElementById('device-menu');
const folderName = document.getElementById('record-folder-name');
const FORMATS = ['mp4', 'webm'];
const RESOLUTIONS = ['native', '2160', '1440', '1080', '720'];
const FPS_OPTIONS = [60, 30, 24];
const picker = document.getElementById('window-picker');
// Pixel sizes read as plain numbers, without thousands separators.
let pixelFormat = new Intl.NumberFormat(intlLocale(), { useGrouping: false });

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    // Settings are a convenience; capturing still works without them.
  }
}

const init = await api.init();
if (!init) {
  api.cancel();
  throw new Error('Recording picker unavailable');
}

const bounds = init.bounds;
const windows = Array.isArray(init.windows) ? init.windows : [];
const settings = loadSettings();

let mode = MODES.includes(settings.mode) ? settings.mode : 'area';
const recordOptions = {
  format: FORMATS.includes(settings.format) ? settings.format : 'mp4',
  resolution: RESOLUTIONS.includes(settings.resolution) ? settings.resolution : 'native',
  fps: FPS_OPTIONS.includes(settings.fps) ? settings.fps : 60,
  // Shared with Settings. '' records none; otherwise 'default' or the device's name.
  microphone: typeof init.devices?.microphone === 'string' ? init.devices.microphone : 'default',
  camera: typeof init.devices?.camera === 'string' ? init.devices.camera : ''
};

// Real devices of a kind, without the system's own aliases for the default.
async function listDevices(kind) {
  try {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === kind && device.deviceId !== 'default' && device.deviceId !== 'communications');
  } catch {
    return [];
  }
}

// Fills a device menu by name. Names only appear after access is granted,
// and a device may be unplugged for now; the saved choice is kept rather
// than silently dropped.
function fillDeviceSelect(select, devices, offLabel, defaultLabel, saved) {
  const options = [new Option(offLabel, ''), new Option(defaultLabel, 'default')];
  for (const device of devices) {
    if (device.label && !options.some((option) => option.value === device.label)) options.push(new Option(device.label, device.label));
  }
  if (saved !== '' && !options.some((option) => option.value === saved)) options.push(new Option(saved, saved));
  for (const option of options) option.dir = 'auto';
  select.replaceChildren(...options);
  select.value = saved;
}

async function loadMicrophones() {
  fillDeviceSelect(micSelect, await listDevices('audioinput'), t('capture.record.micOff'), t('capture.record.micDefault'), recordOptions.microphone);
}

async function loadCameras() {
  fillDeviceSelect(cameraSelect, await listDevices('videoinput'), t('capture.record.cameraOff'), t('capture.record.cameraDefault'), recordOptions.camera);
  syncFacecam();
}

// Device names stay hidden until access is granted once. Opening the menu
// asks for it, so every connected microphone and camera can be listed.
async function unlockDeviceNames() {
  const [microphones, cameras] = await Promise.all([listDevices('audioinput'), listDevices('videoinput')]);
  const request = {
    audio: false,
    video: cameras.some((device) => !device.label)
  };
  if (microphones.some((device) => !device.label)) await api.requestMicrophoneAccess();
  if (!request.video) { await loadMicrophones(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(request);
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Access was declined; the menus still offer Off and Default.
  }
  await Promise.all([loadMicrophones(), loadCameras()]);
}

function shareDevices() {
  api.setDevices({ microphone: recordOptions.microphone, camera: recordOptions.camera });
}

function placeDeviceMenu() {
  const anchor = moreButton.getBoundingClientRect();
  const width = deviceMenu.offsetWidth;
  const left = clamp(anchor.left + anchor.width / 2 - width / 2, 16, window.innerWidth - width - 16);
  deviceMenu.style.left = `${left}px`;
  deviceMenu.style.bottom = `${window.innerHeight - anchor.top + 10}px`;
}

function setDeviceMenuOpen(open) {
  if (deviceMenu.hidden === !open) return;
  deviceMenu.hidden = !open;
  moreButton.setAttribute('aria-expanded', String(open));
  if (!open) return;
  placeDeviceMenu();
  micSelect.focus();
  void unlockDeviceNames();
}
// The camera could not start: say so. It is tried again when the choice changes.
api.onCameraError(() => showHint(t('capture.record.cameraFailed')));
// Plugged-in, unplugged, and newly paired devices show up right away.
navigator.mediaDevices?.addEventListener('devicechange', () => {
  void loadMicrophones();
  void loadCameras();
});
let selection = null;
let interaction = null;
let pointer = null;
let hoveredWindow = null;
// Windows shown in the picker, with their preview once it arrives.
let pickerWindows = windows.map((entry) => ({ ...entry, url: undefined }));
let pickerBuilt = false;
let thumbnailsRequested = false;
let busy = false;
let hintTimer = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toGlobal(rect) {
  return { x: rect.x + bounds.x, y: rect.y + bounds.y, width: rect.width, height: rect.height };
}

function clampToDisplay(rect) {
  const x = clamp(rect.x, 0, bounds.width);
  const y = clamp(rect.y, 0, bounds.height);
  return {
    x,
    y,
    width: clamp(rect.x + rect.width, 0, bounds.width) - x,
    height: clamp(rect.y + rect.height, 0, bounds.height) - y
  };
}

function restoreSavedArea() {
  const area = settings.area;
  if (!area || ![area.x, area.y, area.width, area.height].every(Number.isFinite)) return;
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;
  if (centerX < bounds.x || centerX >= bounds.x + bounds.width || centerY < bounds.y || centerY >= bounds.y + bounds.height) return;
  const local = clampToDisplay({ x: area.x - bounds.x, y: area.y - bounds.y, width: area.width, height: area.height });
  if (local.width >= MIN_SELECTION && local.height >= MIN_SELECTION) {
    selection = local;
    api.reportSelection(true);
  }
}

function saveArea() {
  if (selection !== null) saveSettings({ area: toGlobal(selection) });
}

function showHint(message) {
  window.clearTimeout(hintTimer);
  toolbarHint.textContent = message;
  toolbarHint.hidden = false;
  hintTimer = window.setTimeout(() => {
    toolbarHint.hidden = true;
  }, 2600);
}

function placeBox(element, rect) {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

// The hint sits above the toolbar, which grows when its options wrap.
// Dividers are hidden once it wraps, since they would sit at the ends of rows.
// It counts as wrapped when its last item sits below its first.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--toolbar-height', `${toolbar.offsetHeight}px`);
  const first = toolbar.firstElementChild;
  const last = captureButton;
  const firstBox = first?.getBoundingClientRect();
  const wrapped = firstBox !== undefined && last.getBoundingClientRect().top > firstBox.top + firstBox.height / 2;
  if (toolbar.dataset.wrapped !== String(wrapped)) toolbar.dataset.wrapped = String(wrapped);
}).observe(toolbar);

// The camera bubble shows while a recording with a camera is being set up,
// so it can be placed and sized before recording starts.
let facecamShown = null;
function syncFacecam() {
  const camera = recordOptions.format === 'mp4' && recordOptions.camera !== '' ? recordOptions.camera : null;
  if (camera === facecamShown) return;
  facecamShown = camera;
  api.setFacecam(camera);
}

function render() {
  syncFacecam();
  body.dataset.mode = mode;
  captureButton.textContent = t('capture.actions.record');
  body.dataset.hasSelection = selection !== null ? 'true' : 'false';
  body.dataset.pointerHere = pointer !== null ? 'true' : 'false';

  for (const button of modeButtons) {
    button.setAttribute('aria-checked', String(button.dataset.mode === mode));
  }

  if (mode === 'area' && selection !== null) {
    selectionElement.hidden = false;
    placeBox(selectionElement, selection);
    selectionSize.textContent = t('capture.selection.size', {
      width: pixelFormat.format(Math.round(selection.width)),
      height: pixelFormat.format(Math.round(selection.height))
    });
    selectionSize.dataset.inside = selection.y < 30 ? 'true' : 'false';
  } else {
    selectionElement.hidden = true;
  }

  crosshairHint.hidden = !(mode === 'area' && selection === null && init.isCursorDisplay && interaction === null);

  picker.hidden = !(mode === 'window' && init.isCursorDisplay);
  if (!picker.hidden) {
    if (!pickerBuilt) buildPicker();
    for (const card of picker.querySelectorAll('.window-card')) {
      card.setAttribute('aria-selected', String(Number(card.dataset.id) === hoveredWindow?.id));
    }
  }

  if (mode === 'screen' && pointer !== null) {
    highlight.hidden = false;
    placeBox(highlight, { x: 0, y: 0, width: bounds.width, height: bounds.height });
    highlightLabel.textContent = t('capture.hints.clickScreen');
  } else {
    highlight.hidden = true;
  }
}

function windowLabel(entry) {
  return entry.title ? t('capture.picker.windowLabel', { app: entry.app, title: entry.title }) : entry.app || t('capture.picker.untitled');
}

// Lays the windows out in a grid that fits the screen, like Mission Control.
function layoutPicker(cards) {
  const margin = 56;
  const bottomSpace = 150;
  const gap = 28;
  const labelSpace = 30;
  const areaWidth = bounds.width - margin * 2;
  const areaHeight = bounds.height - margin - bottomSpace;
  const count = cards.length;
  let best = null;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (areaWidth - gap * (columns - 1)) / columns;
    const cellHeight = (areaHeight - gap * (rows - 1)) / rows - labelSpace;
    if (cellWidth <= 0 || cellHeight <= 0) continue;
    const covered = pickerWindows.reduce((sum, entry) => {
      const scale = Math.min(cellWidth / entry.width, cellHeight / entry.height, 1);
      return sum + entry.width * entry.height * scale * scale;
    }, 0);
    if (best === null || covered > best.covered) best = { columns, rows, cellWidth, cellHeight, covered };
  }
  if (best === null) return;
  const usedHeight = best.rows * (best.cellHeight + labelSpace) + gap * (best.rows - 1);
  const top = margin + (areaHeight - usedHeight) / 2;
  cards.forEach((card, index) => {
    const entry = pickerWindows[index];
    const row = Math.floor(index / best.columns);
    const inRow = Math.min(best.columns, count - row * best.columns);
    const rowWidth = inRow * best.cellWidth + gap * (inRow - 1);
    const column = index % best.columns;
    const scale = Math.min(best.cellWidth / entry.width, best.cellHeight / entry.height, 1);
    const width = Math.max(120, entry.width * scale);
    const height = entry.height * scale + labelSpace;
    const cellX = margin + (areaWidth - rowWidth) / 2 + column * (best.cellWidth + gap);
    const cellY = top + row * (best.cellHeight + labelSpace + gap);
    placeBox(card, {
      x: cellX + (best.cellWidth - width) / 2,
      y: cellY + (best.cellHeight + labelSpace - height) / 2,
      width,
      height
    });
  });
}

function buildPicker() {
  pickerBuilt = true;
  picker.replaceChildren();
  if (pickerWindows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'window-empty';
    empty.textContent = t('capture.picker.empty');
    picker.append(empty);
    return;
  }
  const cards = pickerWindows.map((entry) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'window-card';
    card.dataset.id = String(entry.id);
    card.setAttribute('role', 'option');
    card.setAttribute('aria-label', windowLabel(entry));
    const thumb = document.createElement('img');
    thumb.className = 'window-thumb';
    thumb.alt = '';
    thumb.decoding = 'async';
    if (entry.url) thumb.src = entry.url;
    const label = document.createElement('span');
    label.className = 'window-card-label';
    label.textContent = windowLabel(entry);
    card.append(thumb, label);
    card.addEventListener('pointerenter', () => {
      hoveredWindow = entry;
      render();
    });
    card.addEventListener('focus', () => {
      hoveredWindow = entry;
      render();
    });
    card.addEventListener('click', () => {
      hoveredWindow = entry;
      commit();
    });
    return card;
  });
  picker.append(...cards);
  layoutPicker(cards);
}

function requestThumbnails() {
  if (thumbnailsRequested || !init.isCursorDisplay) return;
  thumbnailsRequested = true;
  api.requestThumbnails();
}

function moveSelection(step) {
  if (pickerWindows.length === 0) return;
  const index = pickerWindows.findIndex((entry) => entry.id === hoveredWindow?.id);
  const next = index < 0 ? 0 : (index + step + pickerWindows.length) % pickerWindows.length;
  hoveredWindow = pickerWindows[next];
  picker.querySelector(`[data-id="${hoveredWindow.id}"]`)?.focus();
  render();
}

function setMode(nextMode, broadcast = true) {
  if (!MODES.includes(nextMode)) return;
  mode = nextMode;
  saveSettings({ mode });
  if (broadcast) api.setMode(mode);
  if (mode === 'window') requestThumbnails();
  else hoveredWindow = null;
  render();
}

async function perform(request) {
  if (busy) return;
  busy = true;
  setDeviceMenuOpen(false);
  // The device name lets the native recorder find the same microphone; the
  // web recorder needs its id. A missing microphone falls back to the default.
  const { microphone, ...options } = recordOptions;
  let micId = microphone;
  if (microphone !== '' && microphone !== 'default') {
    micId = (await listDevices('audioinput')).find((device) => device.label === microphone)?.deviceId ?? 'default';
  }
  request = { ...request, ...options, micId, micLabel: micId === 'default' ? '' : microphone };
  request = { ...request, systemAudio: document.getElementById('system-audio').checked, systemAudioPid: Number(document.getElementById('system-audio-app').value) || null };
  body.dataset.phase = 'capturing';
  const result = await api.perform(request).catch(() => ({ ok: false, error: t('capture.errors.captureFailed') }));
  if (!result.ok && body.dataset.phase === 'capturing') {
    busy = false;
    body.dataset.phase = 'select';
    if (result.error) showHint(result.error);
  }
}

function commit() {
  if (busy) return;
  if (mode === 'area') {
    if (selection !== null && selection.width >= MIN_SELECTION && selection.height >= MIN_SELECTION) {
      saveArea();
      void perform({ mode: 'area', rect: toGlobal(selection) });
    } else {
      showHint(t('capture.hints.selectAreaFirst'));
    }
    return;
  }
  if (mode === 'window') {
    const target = hoveredWindow;
    if (target !== null) {
      void perform({ mode: 'window', rect: { x: target.x, y: target.y, width: target.width, height: target.height }, windowId: target.id });
    } else {
      showHint(t('capture.hints.chooseWindow'));
    }
    return;
  }
  void perform({ mode: 'screen', rect: { ...bounds } });
}

function pointFrom(event) {
  return { x: clamp(event.clientX, 0, bounds.width), y: clamp(event.clientY, 0, bounds.height) };
}

function inside(rect, point) {
  return rect !== null && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function updateInteraction(point) {
  const dx = point.x - interaction.start.x;
  const dy = point.y - interaction.start.y;
  const origin = interaction.origin;

  if (interaction.type === 'draw') {
    selection = {
      x: Math.min(interaction.start.x, point.x),
      y: Math.min(interaction.start.y, point.y),
      width: Math.abs(dx),
      height: Math.abs(dy)
    };
    return;
  }

  if (interaction.type === 'move') {
    selection = {
      x: clamp(origin.x + dx, 0, bounds.width - origin.width),
      y: clamp(origin.y + dy, 0, bounds.height - origin.height),
      width: origin.width,
      height: origin.height
    };
    return;
  }

  const handle = interaction.handle;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;
  if (handle.includes('w')) left = clamp(origin.x + dx, 0, bounds.width);
  if (handle.includes('e')) right = clamp(origin.x + origin.width + dx, 0, bounds.width);
  if (handle.includes('n')) top = clamp(origin.y + dy, 0, bounds.height);
  if (handle.includes('s')) bottom = clamp(origin.y + origin.height + dy, 0, bounds.height);
  selection = {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top)
  };
}

document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.device-menu')) return;
  if (!event.target.closest('#record-more')) setDeviceMenuOpen(false);
  if (busy || event.button !== 0 || event.target.closest('.toolbar')) return;
  const point = pointFrom(event);
  pointer = point;

  if (mode === 'window') return;
  if (mode === 'screen') {
    commit();
    return;
  }

  const handle = event.target.closest('.handle')?.dataset.handle;
  if (handle && selection !== null) {
    interaction = { type: 'resize', handle, start: point, origin: { ...selection } };
  } else if (inside(selection, point)) {
    interaction = { type: 'move', start: point, origin: { ...selection } };
  } else {
    interaction = { type: 'draw', start: point, origin: null };
    selection = { x: point.x, y: point.y, width: 0, height: 0 };
    api.reportSelection(true);
  }
  body.dataset.interaction = interaction.type;
  document.body.setPointerCapture(event.pointerId);
  render();
});

document.addEventListener('pointermove', (event) => {
  if (busy) return;
  const point = pointFrom(event);
  pointer = point;
  if (interaction !== null) {
    updateInteraction(point);
  }
  if (mode !== 'window') render();
});

document.addEventListener('pointerup', (event) => {
  if (interaction === null) return;
  const finished = interaction;
  interaction = null;
  delete body.dataset.interaction;
  try {
    document.body.releasePointerCapture(event.pointerId);
  } catch {
    // The capture may already be gone.
  }
  if (finished.type === 'draw' && (selection === null || selection.width < MIN_SELECTION || selection.height < MIN_SELECTION)) {
    selection = null;
    api.reportSelection(false);
  } else {
    saveArea();
  }
  render();
});

document.documentElement.addEventListener('pointerleave', () => {
  if (interaction !== null) return;
  pointer = null;
  render();
});

document.addEventListener('dblclick', (event) => {
  if (mode === 'area' && inside(selection, pointFrom(event))) commit();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!deviceMenu.hidden) {
      setDeviceMenuOpen(false);
      moreButton.focus();
      return;
    }
    api.cancel();
    return;
  }
  if (busy || event.target.closest?.('.device-menu')) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    api.enter(mode);
    return;
  }
  if (event.key === '1' || event.key === '2' || event.key === '3') {
    setMode(MODES[Number(event.key) - 1]);
    return;
  }
  if (mode === 'window' && init.isCursorDisplay && event.key.startsWith('Arrow')) {
    event.preventDefault();
    moveSelection(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
    return;
  }
  if (mode === 'area' && selection !== null && event.key.startsWith('Arrow')) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    selection = {
      ...selection,
      x: clamp(selection.x + dx, 0, bounds.width - selection.width),
      y: clamp(selection.y + dy, 0, bounds.height - selection.height)
    };
    saveArea();
    render();
  }
}, { capture: true });

for (const button of modeButtons) {
  button.addEventListener('click', () => setMode(button.dataset.mode));
}
// Every display shows the toolbar; a change on one is mirrored on the others.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  const next = loadSettings();
  if (FORMATS.includes(next.format)) recordOptions.format = next.format;
  if (RESOLUTIONS.includes(next.resolution)) recordOptions.resolution = next.resolution;
  if (FPS_OPTIONS.includes(next.fps)) recordOptions.fps = next.fps;
  if (typeof next.folderName === 'string' && next.folderName) setFolderName(next.folderName);
  formatSelect.value = recordOptions.format;
  resolutionSelect.value = recordOptions.resolution;
  fpsSelect.value = String(recordOptions.fps);
  render();
});
formatSelect.value = recordOptions.format;
resolutionSelect.value = recordOptions.resolution;
fpsSelect.value = String(recordOptions.fps);
formatSelect.addEventListener('change', () => {
  recordOptions.format = formatSelect.value;
  saveSettings({ format: recordOptions.format });
  syncFacecam();
});
resolutionSelect.addEventListener('change', () => {
  recordOptions.resolution = resolutionSelect.value;
  saveSettings({ resolution: recordOptions.resolution });
});
micSelect.addEventListener('change', () => {
  recordOptions.microphone = micSelect.value;
  shareDevices();
});
void loadMicrophones();
cameraSelect.addEventListener('change', () => {
  recordOptions.camera = cameraSelect.value;
  shareDevices();
  syncFacecam();
});
void loadCameras();
moreButton.addEventListener('click', () => setDeviceMenuOpen(deviceMenu.hidden));
window.addEventListener('resize', () => {
  if (!deviceMenu.hidden) placeDeviceMenu();
});
// A choice made on another display or in Settings.
api.onDevices((devices) => {
  if (typeof devices?.microphone !== 'string' || typeof devices?.camera !== 'string') return;
  const cameraChanged = devices.camera !== recordOptions.camera;
  recordOptions.microphone = devices.microphone;
  recordOptions.camera = devices.camera;
  void loadMicrophones();
  if (cameraChanged) void loadCameras();
});
// The chosen folder's own name is shown as is; the default label is translated.
let chosenFolderName = null;
function setFolderName(name) {
  chosenFolderName = name;
  renderFolderName();
}
function renderFolderName() {
  folderName.textContent = chosenFolderName ?? t('capture.record.defaultFolder');
}
if (typeof init.recordingFolder === 'string' && init.recordingFolder) setFolderName(init.recordingFolder);
else renderFolderName();
folderButton.addEventListener('click', async () => {
  const chosen = await api.chooseFolder().catch(() => null);
  if (typeof chosen === 'string' && chosen) {
    setFolderName(chosen);
    saveSettings({ folderName: chosen });
  }
});
fpsSelect.addEventListener('change', () => {
  recordOptions.fps = Number(fpsSelect.value);
  saveSettings({ fps: recordOptions.fps });
});
document.getElementById('capture-button').addEventListener('click', () => api.enter(mode));
document.getElementById('capture-cancel').addEventListener('click', () => api.cancel());

api.onMode((nextMode) => setMode(nextMode, false));
api.onClearSelection(() => {
  selection = null;
  interaction = null;
  render();
});
api.onCommit(commit);
api.onThumbnail(({ id, url }) => {
  const entry = pickerWindows.find((candidate) => candidate.id === id);
  if (entry === undefined) return;
  if (url === null) {
    // Invisible helper windows produce empty previews; leave them out.
    pickerWindows = pickerWindows.filter((candidate) => candidate.id !== id);
    if (hoveredWindow?.id === id) hoveredWindow = null;
    if (pickerBuilt) {
      pickerBuilt = false;
      render();
    }
    return;
  }
  entry.url = url;
  const thumb = picker.querySelector(`[data-id="${id}"] .window-thumb`);
  if (thumb !== null) thumb.src = url;
});

onLocaleChange(() => {
  pixelFormat = new Intl.NumberFormat(intlLocale(), { useGrouping: false });
  renderFolderName();
  void loadMicrophones();
  void loadCameras();
  // Window cards carry translated labels; rebuild them the next time the picker shows.
  pickerBuilt = false;
  render();
});

toolbar.hidden = false;
if (init.cursor) {
  const localX = init.cursor.x - bounds.x;
  const localY = init.cursor.y - bounds.y;
  if (localX >= 0 && localY >= 0 && localX < bounds.width && localY < bounds.height) {
    pointer = { x: localX, y: localY };
  }
}
restoreSavedArea();
setMode(mode, init.isCursorDisplay);
body.dataset.ready = 'true';

const audioApps = document.getElementById('system-audio-app');
const seenAudioApps = new Set();
for (const window of init.windows ?? []) { if (!window.pid || seenAudioApps.has(window.pid)) continue; seenAudioApps.add(window.pid); audioApps.append(new Option(window.app, String(window.pid))); }

audioApps.disabled = init.platform !== 'darwin';
