import { normalizeCaptions, subtitleText } from './captions.js';
import { t, formatNumber, initI18n, onLocaleChange } from '../shared/i18n.js';
import {
  ASPECTS,
  BACKGROUNDS,
  CAMERA_POSITIONS,
  CAMERA_SHAPES,
  CLICK_SOUNDS,
  KEY_POSITIONS,
  KEY_SIZES,
  TYPING_SOUNDS,
  MIN_CLIP,
  SPEEDS,
  buildCameraTrack,
  buildCursorTrack,
  clipOffsets,
  cursorAt,
  drawFrame,
  frameShape,
  motionAt,
  normalizeClips,
  normalizeLook,
  normalizeInteractions,
  normalizeProject,
  normalizeZooms,
  outputAt,
  outputDuration,
  outputEvents,
  outputSize,
  planZooms,
  sourceAt
} from './engine.js';
import { createTimeline } from './timeline.js';
import { ExportCanceled, QUALITY_BITS, runExport } from './export.js';
import { keyVariant, soundSet } from './sounds.js';

initI18n({ direction: true });

const api = window.recordingEditor;
const DEFAULT_BACKGROUND = 'dusk';
const ASPECT_LABELS = {
  auto: 'editor.frame.auto',
  wide: 'editor.frame.wide',
  classic: 'editor.frame.classic',
  square: 'editor.frame.square',
  portrait: 'editor.frame.portrait',
  tall: 'editor.frame.tall'
};
const RESOLUTIONS = [
  { id: 'source', shortSide: Infinity, label: 'editor.export.original' },
  { id: '2160', shortSide: 2160, label: 'editor.export.uhd' },
  { id: '1440', shortSide: 1440, label: 'editor.export.qhd' },
  { id: '1080', shortSide: 1080, label: 'editor.export.fullHd' },
  { id: '720', shortSide: 720, label: 'editor.export.hd' }
];
const QUALITIES = ['standard', 'high', 'max'];
const HISTORY_LIMIT = 100;
const NEW_ZOOM_SECONDS = 2.5;
// Motion blur covers the movement of one frame at this rate, in preview and export alike.
const BLUR_FRAME = 1 / 60;

const $ = (id) => document.getElementById(id);
let captionUIReady = false;
const canvas = $('canvas');
const context = canvas.getContext('2d', { alpha: false });
const playButton = $('play');
const exportButton = $('export');
const toast = $('toast');
const controls = {
  padding: $('padding'),
  radius: $('radius'),
  shadow: $('shadow'),
  autoZoom: $('auto-zoom'),
  zoomScale: $('zoom-scale'),
  smoothness: $('smoothness'),
  clickEffects: $('click-effects'),
  cursorSize: $('cursor-size'),
  cursorSmoothing: $('cursor-smoothing'),
  hideIdleCursor: $('hide-idle-cursor'),
  motionBlur: $('motion-blur'),
  shortcuts: $('show-shortcuts')
};

const LOAD_TIMEOUT_MS = 20000;

// Shows why the recording cannot be edited, with a way to close the window,
// and stops here.
async function cannotOpen(error) {
  console.error(error);
  document.body.dataset.state = 'error';
  for (const element of document.querySelectorAll('header, main')) element.inert = true;
  $('load-error').hidden = false;
  $('load-error-close').focus();
  return new Promise(() => undefined);
}
$('load-error-close').addEventListener('click', () => api.close());

// Waits for a media event, failing on an error or after a while.
function mediaEvent(element, name, timeout = LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), timeout);
    element.addEventListener(name, () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    element.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error('The video could not be opened'));
    }, { once: true });
  });
}

const init = await api.init().catch(cannotOpen);
if (!init) {
  api.close();
  await new Promise(() => undefined);
}
document.body.dataset.theme = init.theme === 'light' ? 'light' : 'dark';
$('title').textContent = init.name;
$('open-after').checked = init.openAfterRecording;

const interactions = normalizeInteractions(init.interactions);

const video = document.createElement('video');
video.preload = 'auto';
video.playsInline = true;
video.preservesPitch = true;
// Frames are read back for export, so the video is loaded with CORS.
video.crossOrigin = 'anonymous';
video.src = init.videoUrl;
await mediaEvent(video, 'loadedmetadata').catch(cannotOpen);
// Recorded files often have no stored length until the end has been read.
if (!Number.isFinite(video.duration)) {
  const known = new Promise((resolve) => {
    video.addEventListener('durationchange', function check() {
      if (!Number.isFinite(video.duration)) return;
      video.removeEventListener('durationchange', check);
      resolve();
    });
  });
  video.currentTime = Number.MAX_SAFE_INTEGER;
  await Promise.race([known, mediaEvent(video, 'never-fires')]).catch(cannotOpen);
  video.currentTime = 0;
}
// The first picture must be decoded before the first frame is drawn.
if (video.readyState < 2) await mediaEvent(video, 'loadeddata').catch(cannotOpen);
if (!(video.duration > 0) || !(video.videoWidth > 0) || !(video.videoHeight > 0)) await cannotOpen(new Error('The video has no picture'));
const duration = video.duration;
const videoWidth = video.videoWidth;
const videoHeight = video.videoHeight;

// The camera track, recorded on the same clock as the screen.
let cameraVideo = null;
if (init.cameraUrl) {
  const element = document.createElement('video');
  element.preload = 'auto';
  element.muted = true;
  element.playsInline = true;
  element.crossOrigin = 'anonymous';
  element.src = init.cameraUrl;
  // The screen recording can still be edited when its camera track cannot be read.
  cameraVideo = await mediaEvent(element, 'loadeddata').then(() => element, () => null);
}
const CAMERA_DRIFT = 0.08;

// Keeps the camera on the same moment as the screen.
function syncCamera(source, playing) {
  if (cameraVideo === null) return;
  const target = Math.min(source, Math.max(0, cameraVideo.duration - 0.01));
  cameraVideo.playbackRate = video.playbackRate;
  const seek = Math.abs(cameraVideo.currentTime - target) > (playing ? CAMERA_DRIFT : 1 / 240);
  if (seek) cameraVideo.currentTime = target;
  if (playing && cameraVideo.paused) void cameraVideo.play().catch(() => undefined);
  if (!playing && !cameraVideo.paused) cameraVideo.pause();
  return seek;
}

// ---- Project state and history -------------------------------------------

const project = normalizeProject(init.project, duration, interactions, videoWidth, videoHeight);
// A new edit starts with the camera where the live bubble was left while recording.
if (!init.project && interactions?.cameraHint) {
  project.look.cameraPosition = interactions.cameraHint.position;
  project.look.cameraSize = interactions.cameraHint.size;
}
let selection = null;
const past = [];
const future = [];

const snapshot = () => JSON.stringify({ look: project.look, clips: project.clips, zooms: project.zooms, captions: project.captions, captionsEnabled: project.captionsEnabled });

function restore(saved) {
  const data = JSON.parse(saved);
  project.look = data.look;
  project.clips = data.clips;
  project.zooms = data.zooms;
  project.captions = data.captions ?? []; project.captionsEnabled = data.captionsEnabled === true;
  selection = null;
}

// Assets that are loaded once.
let backgroundImage = null;
let backgroundUrl = null;
const cursorImages = new Map();
for (const [id, sprite] of Object.entries(interactions?.cursors ?? {})) {
  const image = new Image();
  image.src = `data:image/png;base64,${sprite.png}`;
  cursorImages.set(id, image);
}
await Promise.all([...cursorImages.values()].map((image) => image.decode().catch(() => undefined)));

async function loadBackground(url) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  backgroundImage = image;
  backgroundUrl = url;
}
if (init.backgroundUrl) {
  await loadBackground(init.backgroundUrl).catch(() => undefined);
}
if (project.look.background === 'image' && backgroundImage === null) project.look.background = DEFAULT_BACKGROUND;

// Values derived from the project, rebuilt when it changes.
const derived = { offsets: [], total: 0, cameraTrack: new Float32Array(6), cursorTrack: new Float32Array(6), events: { clicks: [], shortcuts: [] } };

function rebuild({ camera = true, cursor = true } = {}) {
  derived.offsets = clipOffsets(project.clips);
  derived.total = outputDuration(project.clips);
  derived.events = outputEvents(interactions, project.clips);
  if (camera) derived.cameraTrack = buildCameraTrack(interactions, project.zooms, project.clips, project.look, shape());
  if (cursor) derived.cursorTrack = buildCursorTrack(interactions, project.clips, project.look);
}

let saveTimer = 0;
let savePending = false;
const projectData = () => JSON.stringify({ version: 2, look: project.look, clips: project.clips, zooms: project.zooms, captions: project.captions, captionsEnabled: project.captionsEnabled });

function saveProject() {
  window.clearTimeout(saveTimer);
  savePending = true;
  saveTimer = window.setTimeout(() => {
    savePending = false;
    void api.saveProject(projectData()).then((saved) => {
      if (!saved) showToast(t('editor.saveFailed'));
    }, () => showToast(t('editor.saveFailed')));
  }, 400);
}

// Closing the window never loses the last change.
window.addEventListener('beforeunload', () => {
  if (dragStart !== null) endDrag();
  if (!savePending) return;
  window.clearTimeout(saveTimer);
  savePending = false;
  api.saveProjectNow(projectData());
});

// Applies an edit as one undoable step.
function commit(mutate, options) {
  if (timelineDragging) return;
  if (dragStart !== null) endDrag();
  const before = snapshot();
  mutate(project);
  project.clips = normalizeClips(project.clips, duration);
  project.zooms = normalizeZooms(project.zooms, duration);
  if (snapshot() === before) return;
  past.push(before);
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  afterChange(options);
}

// Live edits while dragging are recorded as one step when the drag ends.
let dragStart = null;
let timelineDragging = false;
function beginDrag() {
  dragStart = snapshot();
}
function dragEdit(mutate) {
  mutate(project);
  afterChange({ camera: true, cursor: false, quiet: true });
}
function endDrag() {
  if (dragStart === null) return;
  const before = dragStart;
  dragStart = null;
  project.clips = normalizeClips(project.clips, duration);
  project.zooms = normalizeZooms(project.zooms, duration);
  if (snapshot() !== before) {
    past.push(before);
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  afterChange();
}

function undo() {
  if (timelineDragging || exporting) return;
  if (dragStart !== null) endDrag();
  if (past.length === 0) return;
  future.push(snapshot());
  restore(past.pop());
  afterChange();
}

function redo() {
  if (timelineDragging || exporting) return;
  if (dragStart !== null) endDrag();
  if (future.length === 0) return;
  past.push(snapshot());
  restore(future.pop());
  afterChange();
}

function afterChange({ camera = true, cursor = true, quiet = false } = {}) {
  rebuild({ camera, cursor });
  resizeCanvas();
  if (!quiet) saveProject();
  playhead = Math.min(playhead, derived.total);
  renderControls();
  if (video.paused) {
    showAt(playhead);
    return;
  }
  // Keep playing from the same moment of the changed edit.
  const { time: source, index } = sourceAt(project.clips, derived.offsets, playhead);
  playingClip = index;
  video.playbackRate = project.clips[index].speed;
  if (Math.abs(video.currentTime - source) > 0.05) video.currentTime = source;
}

// ---- Drawing and playback -------------------------------------------------

let playhead = 0;
let exporting = false;

function resizeCanvas() {
  const size = outputSize(videoWidth, videoHeight, project.look.aspect);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
}

function render(time, sourceTime) {
  drawFrame(context, {
    video,
    videoWidth,
    videoHeight,
    look: project.look,
    captions: project.captions, captionsEnabled: project.captionsEnabled,
    interactions,
    time,
    sourceTime,
    events: derived.events,
    backgroundImage,
    cursorImages,
    cameraVideo: cameraVideo !== null && cameraVideo.readyState >= 2 ? cameraVideo : null,
    cameraWidth: cameraVideo?.videoWidth ?? 0,
    cameraHeight: cameraVideo?.videoHeight ?? 0,
    ...motionAt(derived.cameraTrack, derived.cursorTrack, project.clips, derived.offsets, time, BLUR_FRAME)
  });
  timeline.setPlayhead(sourceTime);
  $('time').textContent = `${formatTime(time)} / ${formatTime(derived.total)}`;
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Shows the frame at an output time once the video has reached it.
let seekToken = 0;
function showAt(time) {
  playhead = Math.min(derived.total, Math.max(0, time));
  const { time: source } = sourceAt(project.clips, derived.offsets, playhead);
  const token = ++seekToken;
  if (Math.abs(video.currentTime - source) < 1 / 240) {
    render(playhead, source);
    return;
  }
  video.addEventListener('seeked', () => {
    if (token === seekToken && video.paused) render(playhead, source);
  }, { once: true });
  if (syncCamera(source, false)) {
    cameraVideo.addEventListener('seeked', () => {
      if (token === seekToken && video.paused) render(playhead, source);
    }, { once: true });
  }
  video.currentTime = source;
  render(playhead, source);
}

// Seeking on the timeline uses source time; cut moments jump to the next kept part.
function seekSource(source) {
  let time = outputAt(project.clips, derived.offsets, source);
  if (time === null) {
    const next = project.clips.findIndex((clip) => clip.start > source);
    time = next === -1 ? derived.total : derived.offsets[next];
  }
  if (!video.paused) video.pause();
  showAt(time);
}

// ---- Click and typing sounds ----------------------------------------------

let effects = null;
function effectSounds() {
  const key = `${project.look.clickSound}/${project.look.typingSound}`;
  if (effects !== null && effects.key === key) return effects;
  const context = effects?.context ?? new AudioContext();
  const set = soundSet(project.look, context.sampleRate);
  const buffer = (data) => {
    if (data === null) return null;
    const audio = context.createBuffer(1, data.length, context.sampleRate);
    audio.copyToChannel(data, 0);
    return audio;
  };
  effects = { key, context, click: buffer(set.click), keys: set.keys.map(buffer) };
  return effects;
}

function playSound(buffer, volume) {
  if (buffer === null || buffer === undefined || volume <= 0) return;
  const { context } = effectSounds();
  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = volume;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  source.start();
}

// Plays the sounds whose moments were passed since the last drawn frame.
let heardUntil = -1;
function playPassedSounds(time) {
  const from = heardUntil;
  heardUntil = time;
  if (from < 0 || time <= from || time - from > 0.25) return;
  const sounds = effectSounds();
  for (const click of derived.events.clicks) {
    if (click.t > from && click.t <= time) playSound(sounds.click, project.look.clickVolume);
  }
  derived.events.keys.forEach((key, index) => {
    if (key.t > from && key.t <= time) playSound(sounds.keys[keyVariant(index)], project.look.typingVolume);
  });
}

let playingClip = -1;
// Plays the edited video: each kept part at its speed, jumping over cuts.
function frameLoop() {
  if (video.paused) return;
  const clip = project.clips[playingClip];
  if (clip === undefined) {
    video.pause();
    return;
  }
  if (video.currentTime >= clip.end - 1 / 240 || video.ended) {
    const next = project.clips[playingClip + 1];
    if (next === undefined) {
      video.pause();
      showAt(derived.total);
      return;
    }
    playingClip += 1;
    video.playbackRate = next.speed;
    video.currentTime = next.start;
  }
  const current = project.clips[playingClip];
  const source = Math.min(current.end, Math.max(current.start, video.currentTime));
  syncCamera(source, true);
  playhead = derived.offsets[playingClip] + (source - current.start) / current.speed;
  playPassedSounds(playhead);
  render(playhead, source);
  window.requestAnimationFrame(frameLoop);
}

let starting = false;
async function togglePlay() {
  if (exporting || starting) return;
  if (!video.paused) {
    video.pause();
    return;
  }
  starting = true;
  try {
    if (playhead >= derived.total - 1 / 60) playhead = 0;
    heardUntil = playhead;
    await effectSounds().context.resume().catch(() => undefined);
    const { time: source, index } = sourceAt(project.clips, derived.offsets, playhead);
    playingClip = index;
    video.playbackRate = project.clips[index].speed;
    video.currentTime = source;
    await video.play();
  } catch (error) {
    console.error(error);
  } finally {
    starting = false;
  }
}

video.addEventListener('play', () => {
  document.body.dataset.playing = 'true';
  setPlayLabel();
  window.requestAnimationFrame(frameLoop);
});
video.addEventListener('pause', () => {
  document.body.dataset.playing = 'false';
  cameraVideo?.pause();
  setPlayLabel();
  // Reaching the end of the recording also ends the edit.
  if (video.ended) showAt(derived.total);
});

function setPlayLabel() {
  const label = t(video.paused ? 'editor.play' : 'editor.pause');
  playButton.setAttribute('aria-label', label);
  playButton.title = label;
}

// ---- Timeline and editing -------------------------------------------------

const timeline = createTimeline($('timeline'), {
  duration,
  labels: {
    clip: (number) => t('editor.edit.clipLabel', { number }),
    zoom: (scale) => t('editor.edit.zoomLabel', { level: formatNumber(Math.round(scale * 10) / 10) }),
    time: formatTime
  },
  onSeek: seekSource,
  onSelect: (next) => {
    selection = next;
    renderControls();
  },
  onEditStart: () => {
    timelineDragging = true;
    beginDrag();
  },
  onEdit: dragEdit,
  onEditEnd: () => {
    timelineDragging = false;
    endDrag();
  }
});

function currentSource() {
  return sourceAt(project.clips, derived.offsets, playhead);
}

function splitAtPlayhead() {
  const { time, index } = currentSource();
  const clip = project.clips[index];
  if (time - clip.start < MIN_CLIP || clip.end - time < MIN_CLIP) return;
  commit((draft) => {
    draft.clips.splice(index, 1, { ...clip, end: time }, { ...clip, start: time });
  });
  selection = { kind: 'clip', index: index + 1 };
  renderControls();
}

function deleteSelection() {
  if (selection === null) return;
  if (selection.kind === 'clip') {
    if (project.clips.length <= 1) {
      showToast(t('editor.edit.lastClip'));
      return;
    }
    const index = selection.index;
    commit((draft) => { draft.clips.splice(index, 1); });
  } else {
    const id = selection.id;
    commit((draft) => { draft.zooms = draft.zooms.filter((zoom) => zoom.id !== id); });
  }
  selection = null;
  renderControls();
}

function addZoom() {
  const { time } = currentSource();
  const at = interactions === null ? { x: 0.5, y: 0.5 } : cursorAt(interactions.moves, time);
  const start = Math.min(time, Math.max(0, duration - NEW_ZOOM_SECONDS));
  const end = Math.min(duration, start + NEW_ZOOM_SECONDS);
  // Zooms do not overlap: a new one fills only the free time here.
  const overlapping = project.zooms.some((zoom) => zoom.start < end && zoom.end > start);
  if (overlapping) {
    showToast(t('editor.edit.zoomExists'));
    return;
  }
  const id = `m${Date.now().toString(36)}`;
  commit((draft) => {
    draft.look.autoZoom = true;
    draft.zooms.push({
      id,
      start,
      end,
      scale: Math.min(project.look.zoomScale, 2),
      x: Math.min(1, Math.max(0, at.x)),
      y: Math.min(1, Math.max(0, at.y)),
      follow: interactions !== null,
      focusAt: start
    });
  });
  selection = { kind: 'zoom', id };
  renderControls();
}

// The part of the recording the frame shows unzoomed, for its current shape.
function shape(look = project.look) {
  return frameShape(videoWidth, videoHeight, look);
}

// Suggested zooms depend on the frame's shape; zooms added by hand are kept.
function suggestedZooms(draft) {
  const own = draft.zooms.filter((zoom) => !zoom.id.startsWith('z') || zoom.edited);
  const planned = planZooms(interactions, duration, draft.look, shape(draft.look))
    .filter((zoom) => !own.some((entry) => entry.id === zoom.id || (entry.start < zoom.end && entry.end > zoom.start)));
  return [...own, ...planned];
}

function replanZooms() {
  commit((draft) => { draft.zooms = planZooms(interactions, duration, draft.look, shape(draft.look)); });
  selection = null;
  renderControls();
}

$('split').addEventListener('click', splitAtPlayhead);
$('delete').addEventListener('click', deleteSelection);
$('add-zoom').addEventListener('click', addZoom);
$('replan').addEventListener('click', replanZooms);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
playButton.addEventListener('click', () => void togglePlay());

$('speed').addEventListener('change', (event) => {
  if (selection?.kind !== 'clip') return;
  const index = selection.index;
  const speed = Number(event.target.value);
  commit((draft) => { draft.clips[index].speed = speed; });
});

$('zoom-level').addEventListener('input', (event) => {
  if (selection?.kind !== 'zoom') return;
  const id = selection.id;
  if (dragStart === null) beginDrag();
  dragEdit((draft) => {
    const zoom = draft.zooms.find((entry) => entry.id === id);
    if (zoom !== undefined) {
      zoom.scale = Number(event.target.value);
      zoom.edited = true;
    }
  });
});
$('zoom-level').addEventListener('change', endDrag);
$('zoom-level').addEventListener('blur', endDrag);
$('zoom-follow').addEventListener('change', (event) => {
  if (selection?.kind !== 'zoom') return;
  const id = selection.id;
  commit((draft) => {
    const zoom = draft.zooms.find((entry) => entry.id === id);
    if (zoom !== undefined) {
      zoom.follow = event.target.checked;
      zoom.edited = true;
    }
  });
});

document.addEventListener('keydown', (event) => {
  if (exporting || timelineDragging || $('export-dialog').open || document.body.dataset.state !== 'ready') return;
  if (event.target instanceof Element && event.target.closest('[role="radiogroup"]')) return;
  const target = event.target;
  const typing = target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'range';
  if (typing || target instanceof HTMLSelectElement) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command) return;
  const step = event.shiftKey ? 1 : 1 / 30;
  switch (event.key) {
    case ' ':
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      void togglePlay();
      break;
    case 's':
    case 'S':
      splitAtPlayhead();
      break;
    case 'z':
    case 'Z':
      addZoom();
      break;
    case 'Backspace':
    case 'Delete':
      // Not while a slider or switch has focus.
      if (target instanceof HTMLInputElement) return;
      event.preventDefault();
      deleteSelection();
      break;
    case 'Escape':
      selection = null;
      renderControls();
      break;
    case 'ArrowRight':
      if (target instanceof HTMLInputElement) return;
      event.preventDefault();
      if (!video.paused) video.pause();
      showAt(playhead + step);
      break;
    case 'ArrowLeft':
      if (target instanceof HTMLInputElement) return;
      event.preventDefault();
      if (!video.paused) video.pause();
      showAt(playhead - step);
      break;
    default:
      break;
  }
});

// ---- Inspector ------------------------------------------------------------

function buildBackgrounds() {
  const container = $('backgrounds');
  const buttons = Object.entries(BACKGROUNDS).map(([name, colors]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.setAttribute('role', 'radio');
    button.dataset.value = name;
    button.setAttribute('aria-label', t(`editor.background.${name}`));
    button.title = t(`editor.background.${name}`);
    button.style.setProperty('--swatch', colors === null ? 'transparent' : `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`);
    // Switching to or from no background changes the padding, and so the view.
    button.addEventListener('click', () => commit((draft) => { draft.look.background = name; }, { cursor: false }));
    return button;
  });
  if (backgroundImage !== null) {
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'swatch';
    custom.setAttribute('role', 'radio');
    custom.dataset.value = 'image';
    custom.setAttribute('aria-label', t('editor.background.image'));
    custom.title = t('editor.background.image');
    custom.style.setProperty('--swatch', `center / cover no-repeat url("${backgroundUrl}")`);
    custom.addEventListener('click', () => commit((draft) => { draft.look.background = 'image'; }, { camera: false, cursor: false }));
    buttons.push(custom);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'swatch swatch--add';
  add.setAttribute('aria-label', t('editor.background.addImage'));
  add.title = t('editor.background.addImage');
  add.textContent = '+';
  add.addEventListener('click', () => void addBackgroundImage());
  buttons.push(add);
  container.replaceChildren(...buttons);
  $('remove-background').hidden = backgroundImage === null;
}

async function addBackgroundImage() {
  const result = await api.pickBackground();
  if (!result.ok) {
    if (!result.canceled) showToast(t(result.invalid ? 'editor.background.invalidImage' : 'editor.background.imageFailed'));
    return;
  }
  try {
    await loadBackground(result.url);
  } catch {
    showToast(t('editor.background.invalidImage'));
    return;
  }
  const replaced = project.look.backgroundImage;
  buildBackgrounds();
  commit((draft) => {
    draft.look.background = 'image';
    draft.look.backgroundImage = result.id;
  }, { camera: false, cursor: false });
  // The replaced image is removed once this is saved, so undo keeps the new one.
  if (replaced !== null) rewriteHistory((look) => {
    if (look.backgroundImage === replaced) look.backgroundImage = result.id;
  });
}

// Changes every saved undo and redo step, for images that no longer exist.
function rewriteHistory(change) {
  for (const list of [past, future]) {
    for (let i = 0; i < list.length; i += 1) {
      const data = JSON.parse(list[i]);
      change(data.look);
      list[i] = JSON.stringify(data);
    }
  }
}

async function removeBackgroundImage() {
  const id = project.look.backgroundImage;
  if (id === null || !(await api.removeBackground(id))) return;
  backgroundImage = null;
  backgroundUrl = null;
  // The file is gone, so this change is not undoable into the image.
  project.look.backgroundImage = null;
  if (project.look.background === 'image') project.look.background = DEFAULT_BACKGROUND;
  for (const saved of [...past, ...future]) {
    const index = past.indexOf(saved);
    const data = JSON.parse(saved);
    data.look.backgroundImage = null;
    if (data.look.background === 'image') data.look.background = DEFAULT_BACKGROUND;
    if (index !== -1) past[index] = JSON.stringify(data);
    else future[future.indexOf(saved)] = JSON.stringify(data);
  }
  buildBackgrounds();
  afterChange({ camera: false, cursor: false });
}
$('remove-background').addEventListener('click', () => void removeBackgroundImage());

function buildAspects() {
  $('aspects').replaceChildren(...Object.keys(ASPECTS).map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.setAttribute('role', 'radio');
    button.dataset.value = name;
    button.textContent = t(ASPECT_LABELS[name]);
    button.addEventListener('click', () => commit((draft) => {
      draft.look.aspect = name;
      draft.zooms = suggestedZooms(draft);
    }, { cursor: false }));
    return button;
  }));
}

function buildCameraChoices() {
  const shapes = CAMERA_SHAPES.map((shape) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.setAttribute('role', 'radio');
    button.dataset.value = shape;
    button.textContent = t(`editor.camera.shapes.${shape}`);
    button.addEventListener('click', () => commit((draft) => { draft.look.cameraShape = shape; }, { camera: false, cursor: false }));
    return button;
  });
  $('camera-shapes').replaceChildren(...shapes);
  const arrows = { 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' };
  const positions = CAMERA_POSITIONS.map((position) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.setAttribute('role', 'radio');
    button.dataset.value = position;
    button.textContent = arrows[position];
    button.setAttribute('aria-label', t(`editor.camera.positions.${position}`));
    button.title = t(`editor.camera.positions.${position}`);
    button.addEventListener('click', () => commit((draft) => { draft.look.cameraPosition = position; draft.look.cameraRecorded = false; }, { camera: false, cursor: false }));
    return button;
  });
  $('camera-positions').replaceChildren(...positions);
}

const KEY_COLORS = ['#18181b', '#ffffff', '#ff8a3d', '#2563eb', '#16a34a'];
const KEY_COLOR_NAMES = { '#18181b': 'dark', '#ffffff': 'light', '#ff8a3d': 'orange', '#2563eb': 'blue', '#16a34a': 'green' };

function buildSoundChoices() {
  $('click-sound').replaceChildren(...CLICK_SOUNDS.map((style) => new Option(t(`editor.sounds.styles.${style}`), style)));
  $('typing-sound').replaceChildren(...TYPING_SOUNDS.map((style) => new Option(t(`editor.sounds.styles.${style}`), style)));
}

function buildKeyChoices() {
  const colors = KEY_COLORS.map((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.setAttribute('role', 'radio');
    button.dataset.value = color;
    button.setAttribute('aria-label', t(`editor.keys.colors.${KEY_COLOR_NAMES[color]}`));
    button.title = t(`editor.keys.colors.${KEY_COLOR_NAMES[color]}`);
    button.style.setProperty('--swatch', color);
    button.addEventListener('click', () => commit((draft) => { draft.look.keyColor = color; }, { camera: false, cursor: false }));
    return button;
  });
  const custom = document.createElement('label');
  custom.className = 'swatch swatch--color';
  custom.title = t('editor.keys.custom');
  const input = document.createElement('input');
  input.type = 'color';
  input.id = 'key-color-custom';
  input.setAttribute('aria-label', t('editor.keys.custom'));
  input.addEventListener('input', () => {
    if (dragStart === null) beginDrag();
    project.look.keyColor = input.value.toLowerCase();
    afterChange({ camera: false, cursor: false, quiet: true });
  });
  input.addEventListener('change', endDrag);
  custom.append(input);
  $('key-colors').replaceChildren(...colors, custom);

  const segment = (value, label, pick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.setAttribute('role', 'radio');
    button.dataset.value = value;
    button.textContent = label;
    button.addEventListener('click', pick);
    return button;
  };
  $('key-sizes').replaceChildren(...Object.keys(KEY_SIZES).map((size) => segment(size, t(`editor.keys.sizes.${size}`),
    () => commit((draft) => { draft.look.keySize = size; }, { camera: false, cursor: false }))));
  $('key-positions').replaceChildren(...KEY_POSITIONS.map((position) => segment(position, t(`editor.keys.positions.${position}`),
    () => commit((draft) => { draft.look.keyPosition = position; }, { camera: false, cursor: false }))));
}

function buildSpeeds() {
  $('speed').replaceChildren(...SPEEDS.map((speed) => new Option(t('editor.edit.speedValue', { speed: formatNumber(speed) }), String(speed))));
}

// Radio groups: one Tab stop (the chosen option), arrow keys move the choice.
function syncRadioGroups() {
  for (const group of document.querySelectorAll('[role="radiogroup"]')) {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    const checked = radios.find((radio) => radio.getAttribute('aria-checked') === 'true') ?? radios[0];
    for (const radio of radios) radio.tabIndex = radio === checked ? 0 : -1;
  }
}

document.addEventListener('keydown', (event) => {
  const group = event.target instanceof Element ? event.target.closest('[role="radiogroup"]') : null;
  if (group === null || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const radios = [...group.querySelectorAll('[role="radio"]')].filter((radio) => !radio.disabled);
  const index = radios.indexOf(event.target);
  if (index === -1) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const backwards = event.key === 'ArrowUp' || (event.key === 'ArrowLeft') !== (document.documentElement.dir === 'rtl');
  const next = radios[(index + (backwards ? -1 : 1) + radios.length) % radios.length];
  next.click();
  next.focus();
}, true);

function renderControls() {
  if (captionUIReady) renderCaptions();
  const look = project.look;
  for (const button of $('backgrounds').children) {
    if (button.getAttribute('role') === 'radio') button.setAttribute('aria-checked', String(button.dataset.value === look.background));
  }
  for (const button of $('aspects').children) button.setAttribute('aria-checked', String(button.dataset.value === look.aspect));
  const framed = look.background !== 'none';
  controls.padding.value = String(look.padding);
  controls.radius.value = String(look.radius);
  controls.shadow.checked = look.shadow;
  controls.padding.disabled = !framed;
  controls.radius.disabled = !framed;
  controls.shadow.disabled = !framed;
  const hasInput = interactions !== null;
  controls.autoZoom.checked = look.autoZoom;
  controls.zoomScale.value = String(look.zoomScale);
  controls.smoothness.value = String(look.smoothness);
  controls.zoomScale.disabled = !hasInput;
  $('replan').disabled = !hasInput;
  controls.clickEffects.checked = look.clickEffects && hasInput;
  controls.clickEffects.disabled = !hasInput;
  controls.shortcuts.checked = look.shortcuts && hasInput;
  controls.shortcuts.disabled = !hasInput;
  controls.motionBlur.checked = look.motionBlur;
  $('no-cursor').hidden = hasInput;
  // The pointer can only be restyled when it was left out of the video.
  $('cursor-group').hidden = !hasInput || !interactions.cursorHidden;
  controls.cursorSize.value = String(look.cursorSize);
  controls.cursorSmoothing.value = String(look.cursorSmoothing);
  controls.hideIdleCursor.checked = look.hideIdleCursor;
  $('click-sound').value = look.clickSound;
  $('typing-sound').value = look.typingSound;
  $('click-volume').value = String(look.clickVolume);
  $('typing-volume').value = String(look.typingVolume);
  $('click-volume').disabled = look.clickSound === 'none';
  $('typing-volume').disabled = look.typingSound === 'none';
  for (const id of ['click-sound', 'typing-sound']) $(id).disabled = !hasInput;
  for (const button of $('key-colors').querySelectorAll('[role="radio"]')) button.setAttribute('aria-checked', String(button.dataset.value === look.keyColor));
  $('key-color-custom').value = look.keyColor;
  $('key-color-custom').parentElement.classList.toggle('is-selected', !KEY_COLORS.includes(look.keyColor));
  for (const button of $('key-sizes').children) button.setAttribute('aria-checked', String(button.dataset.value === look.keySize));
  for (const button of $('key-positions').children) button.setAttribute('aria-checked', String(button.dataset.value === look.keyPosition));
  for (const id of ['key-colors', 'key-sizes', 'key-positions']) $(id).inert = !look.shortcuts || !hasInput;
  $('camera-group').hidden = cameraVideo === null;
  $('show-camera').checked = look.showCamera;
  for (const button of $('camera-shapes').children) button.setAttribute('aria-checked', String(button.dataset.value === look.cameraShape));
  for (const button of $('camera-positions').children) button.setAttribute('aria-checked', String(button.dataset.value === look.cameraPosition));
  $('camera-size').value = String(look.cameraSize);
  $('camera-shrink').checked = false;
  $('camera-shrink').closest('label').hidden = true;
  $('camera-mirror').checked = look.cameraMirror;
  for (const id of ['camera-shapes', 'camera-positions', 'camera-size', 'camera-shrink', 'camera-mirror']) $(id).inert = !look.showCamera;

  // Selection-dependent tools.
  if (selection?.kind === 'clip' && project.clips[selection.index] === undefined) selection = null;
  if (selection?.kind === 'zoom' && !project.zooms.some((zoom) => zoom.id === selection.id)) selection = null;
  const zoom = selection?.kind === 'zoom' ? project.zooms.find((entry) => entry.id === selection.id) : null;
  $('zoom-inspector').hidden = zoom === null || zoom === undefined;
  if (zoom) {
    $('zoom-level').value = String(zoom.scale);
    $('zoom-follow').checked = zoom.follow;
    $('zoom-follow').disabled = !hasInput;
  }
  $('speed-control').hidden = selection?.kind !== 'clip';
  if (selection?.kind === 'clip') $('speed').value = String(project.clips[selection.index].speed);
  $('delete').disabled = selection === null || (selection.kind === 'clip' && project.clips.length <= 1);
  $('undo').disabled = past.length === 0;
  $('redo').disabled = future.length === 0;
  timeline.render({
    clips: project.clips,
    zooms: project.zooms,
    selection,
    speedLabel: (value) => t('editor.edit.speedValue', { speed: formatNumber(value) })
  });
  syncRadioGroups();
}

// Slider moves are one undo step each, ending when the slider is let go or
// loses focus (Chromium skips 'change' when the value ends where it began).
function bindRange(input, key, options) {
  input.addEventListener('input', () => {
    if (dragStart === null) beginDrag();
    project.look[key] = Number(input.value);
    afterChange({ ...options, quiet: true });
  });
  for (const name of ['change', 'pointerup', 'blur']) input.addEventListener(name, endDrag);
}
bindRange(controls.padding, 'padding', { cursor: false });
bindRange(controls.radius, 'radius', { camera: false, cursor: false });
bindRange(controls.smoothness, 'smoothness', { cursor: false });
bindRange(controls.cursorSize, 'cursorSize', { camera: false, cursor: false });
bindRange(controls.cursorSmoothing, 'cursorSmoothing', { camera: false });
bindRange($('camera-size'), 'cameraSize', { camera: false, cursor: false });
bindRange($('click-volume'), 'clickVolume', { camera: false, cursor: false });
bindRange($('typing-volume'), 'typingVolume', { camera: false, cursor: false });
// Picking a sound plays it once.
$('click-sound').addEventListener('change', (event) => {
  commit((draft) => { draft.look.clickSound = event.target.value; }, { camera: false, cursor: false });
  void effectSounds().context.resume().then(() => playSound(effectSounds().click, project.look.clickVolume));
});
$('typing-sound').addEventListener('change', (event) => {
  commit((draft) => { draft.look.typingSound = event.target.value; }, { camera: false, cursor: false });
  void effectSounds().context.resume().then(() => playSound(effectSounds().keys[0], project.look.typingVolume));
});

// The maximum zoom applies to suggested zooms; they are suggested again for
// it, while zooms that were adjusted by hand keep their level.
controls.zoomScale.addEventListener('change', () => {
  const value = Number(controls.zoomScale.value);
  commit((draft) => {
    draft.look.zoomScale = value;
    draft.zooms = suggestedZooms(draft);
  }, { cursor: false });
});

function bindSwitch(input, key, options) {
  input.addEventListener('change', () => commit((draft) => { draft.look[key] = input.checked; }, options));
}
bindSwitch(controls.shadow, 'shadow', { camera: false, cursor: false });
bindSwitch(controls.autoZoom, 'autoZoom', { cursor: false });
bindSwitch(controls.clickEffects, 'clickEffects', { camera: false, cursor: false });
bindSwitch(controls.hideIdleCursor, 'hideIdleCursor', { camera: false });
bindSwitch(controls.motionBlur, 'motionBlur', { camera: false, cursor: false });
bindSwitch(controls.shortcuts, 'shortcuts', { camera: false, cursor: false });
bindSwitch($('show-camera'), 'showCamera', { camera: false, cursor: false });
bindSwitch($('camera-shrink'), 'cameraShrink', { camera: false, cursor: false });
bindSwitch($('camera-mirror'), 'cameraMirror', { camera: false, cursor: false });
$('open-after').addEventListener('change', (event) => api.setOpenAfterRecording(event.target.checked));
api.onOpenAfterRecording((value) => {
  $('open-after').checked = value;
});

let toastTimer = 0;
function showToast(message, { reveal = false } = {}) {
  $('toast-text').textContent = message;
  $('toast-reveal').hidden = !reveal;
  toast.dataset.visible = 'true';
  scheduleToastHide(reveal ? 8000 : 3000);
}

// Hides the toast unless the pointer or keyboard focus is on it.
function scheduleToastHide(delay) {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toast.matches(':hover, :focus-within')) {
      scheduleToastHide(1500);
      return;
    }
    toast.dataset.visible = 'false';
    // A hidden toast leaves nothing to reach with Tab.
    $('toast-reveal').hidden = true;
  }, delay);
}
if (navigator.userAgent.includes('Windows')) {
  $('toast-reveal').dataset.i18n = 'editor.export.revealWindows';
  $('toast-reveal').textContent = t('editor.export.revealWindows');
}
$('toast-reveal').addEventListener('click', () => void api.revealExport());

// ---- Export ---------------------------------------------------------------

const exportChoice = { resolution: 'source', fps: 60, quality: 'high' };
let exportCanceled = false;

function exportSize() {
  const shortSide = RESOLUTIONS.find((entry) => entry.id === exportChoice.resolution)?.shortSide ?? Infinity;
  return outputSize(videoWidth, videoHeight, project.look.aspect, shortSide);
}

function segmentButtons(container, entries, current, onPick) {
  container.replaceChildren(...entries.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.textContent = label;
    button.title = label;
    button.addEventListener('click', () => {
      onPick(value);
      const focused = document.activeElement === button;
      renderExportDialog();
      // The options were rebuilt; keep focus on the chosen one.
      if (focused) container.querySelector('[aria-checked="true"]')?.focus();
    });
    return button;
  }));
  syncRadioGroups();
}

function renderExportDialog() {
  const full = outputSize(videoWidth, videoHeight, project.look.aspect);
  // Every size is offered, larger ones scaled up; one matching the original is left out.
  const resolutions = RESOLUTIONS.filter((entry) => entry.id === 'source' || entry.shortSide !== Math.min(full.width, full.height));
  if (!resolutions.some((entry) => entry.id === exportChoice.resolution)) exportChoice.resolution = 'source';
  segmentButtons($('export-resolution'), resolutions.map((entry) => ({ value: entry.id, label: t(entry.label) })), exportChoice.resolution, (value) => { exportChoice.resolution = value; });
  segmentButtons($('export-fps'), [30, 60].map((value) => ({ value, label: t('editor.export.fps', { fps: value }) })), exportChoice.fps, (value) => { exportChoice.fps = value; });
  segmentButtons($('export-quality'), QUALITIES.map((value) => ({ value, label: t(`editor.export.qualities.${value}`) })), exportChoice.quality, (value) => { exportChoice.quality = value; });
  const size = exportSize();
  const megabytes = (size.width * size.height * exportChoice.fps * QUALITY_BITS[exportChoice.quality] * derived.total) / 8 / 1e6;
  $('export-summary').textContent = t('editor.export.summary', {
    // Pixel sizes read best without digit grouping.
    width: String(size.width),
    height: String(size.height),
    length: formatTime(derived.total),
    size: formatNumber(Math.max(1, Math.round(megabytes)))
  });
}

function setExporting(active) {
  exporting = active;
  document.body.dataset.state = active ? 'exporting' : 'ready';
  $('export-progress').hidden = !active;
  exportButton.hidden = active;
  for (const element of document.querySelectorAll('.panel input, .panel button, .tools button, .tools select, .timeline, #undo, #redo, #play, #discard')) element.inert = active;
  // Keyboard focus stays on something usable: Cancel while exporting, then the result.
  if (active) $('export-cancel').focus();
}

function setProgress(fraction) {
  const percent = Math.round(fraction * 100);
  $('progress-fill').style.width = `${percent}%`;
  $('progress-value').textContent = t('editor.export.percent', { percent });
}

async function startExport() {
  if (exporting) return;
  if (!video.paused) video.pause();
  const size = exportSize();
  exportCanceled = false;
  setExporting(true);
  setProgress(0);
  try {
    const result = await runExport({
      api,
      video,
      videoUrl: init.videoUrl,
      fileSize: init.fileSize ?? 0,
      cameraVideo,
      cameraFileSize: init.cameraFileSize ?? 0,
      project,
      derived,
      assets: { interactions, backgroundImage, cursorImages },
      settings: { width: size.width, height: size.height, fps: exportChoice.fps, quality: exportChoice.quality },
      onProgress: setProgress,
      isCanceled: () => exportCanceled
    });
    if (result.canceled) return;
    if (result.protected) showToast(t('editor.export.protected'));
    else showToast(t(result.ok ? 'editor.export.saved' : 'editor.export.failed'), { reveal: result.ok });
  } catch (error) {
    if (!(error instanceof ExportCanceled)) {
      console.error(error);
      showToast(t(error instanceof Error && error.message === 'unsupported' ? 'editor.export.unsupported' : 'editor.export.failed'));
    }
  } finally {
    setExporting(false);
    renderControls();
    showAt(playhead);
    if (!$('toast-reveal').hidden) $('toast-reveal').focus();
    else exportButton.focus();
  }
}

exportButton.addEventListener('click', () => {
  if (exporting) return;
  renderExportDialog();
  // Esc keeps the last value, so an earlier export must not start again.
  $('export-dialog').returnValue = '';
  $('export-dialog').showModal();
});
$('export-dialog').addEventListener('close', () => {
  if ($('export-dialog').returnValue === 'export') void startExport();
});
$('export-cancel').addEventListener('click', () => {
  exportCanceled = true;
});
api.onExportFailed(() => {
  exportCanceled = true;
  showToast(t('editor.export.failed'));
});

// ---- Start ----------------------------------------------------------------

function applyLanguage() {
  buildBackgrounds();
  buildAspects();
  buildCameraChoices();
  buildSoundChoices();
  buildKeyChoices();
  buildSpeeds();
  renderControls();
  setPlayLabel();
  timeline.rebuildRuler();
}
onLocaleChange(applyLanguage);

rebuild();
resizeCanvas();
applyLanguage();
showAt(0);
document.body.dataset.state = 'ready';


$('discard').addEventListener('click', async () => {
  if (exporting) return;
  video.pause();
  cameraVideo?.pause();
  $('discard').disabled = true;
  window.clearTimeout(saveTimer);
  savePending = false;
  try {
    await api.saveProject(projectData());
    const result = await api.discard();
    if (!result.ok && !result.canceled) showToast(t('editor.discard.failed'));
  } catch {
    showToast(t('editor.discard.failed'));
  } finally {
    $('discard').disabled = false;
  }
});

let captionJob = null;
const captionRows = $('caption-rows');
function renderCaptions() {
  $('captions-enabled').checked = project.captionsEnabled;
  captionRows.replaceChildren();
  for (const [index, caption] of project.captions.entries()) {
    const row = document.createElement('label'); const label = document.createElement('span'); label.textContent = `${formatTime(caption.start)}–${formatTime(caption.end)}`;
    const text = document.createElement('textarea'); text.value = caption.text; text.rows = 2; text.maxLength = 2000; text.setAttribute('aria-label', `${t('editor.captions.text')} ${label.textContent}`);
    const start = document.createElement('input'); start.type = 'number'; start.step = '0.05'; start.min = '0'; start.max = String(duration); start.value = String(caption.start); start.setAttribute('aria-label', `${t('editor.captions.start')} ${index + 1}`);
    const end = document.createElement('input'); end.type = 'number'; end.step = '0.05'; end.min = '0'; end.max = String(duration); end.value = String(caption.end); end.setAttribute('aria-label', `${t('editor.captions.end')} ${index + 1}`);
    const change = () => { const first = Number(start.value), last = Number(end.value); if (first < 0 || last > duration || last <= first || first < (project.captions[index - 1]?.end ?? 0) || last > (project.captions[index + 1]?.start ?? duration)) { showToast(t('editor.captions.invalidTiming')); return; } commit(draft => { draft.captions[index] = { start: first, end: last, text: text.value }; }); };
    text.addEventListener('change', change); start.addEventListener('change', change); end.addEventListener('change', change); row.append(label, start, end, text); captionRows.append(row);
  }
}
$('generate-captions').addEventListener('click', async () => {
  if (captionJob) return; captionJob = crypto.randomUUID(); $('generate-captions').disabled = true; $('cancel-captions').hidden = false;
  try { const result = await api.transcribe(captionJob); if (result?.captions) { commit(draft => { draft.captions = normalizeCaptions(result.captions, duration); draft.captionsEnabled = true; }); renderCaptions(); } }
  catch { showToast(t('editor.captions.failed')); }
  finally { captionJob = null; $('generate-captions').disabled = false; $('cancel-captions').hidden = true; }
});
$('cancel-captions').addEventListener('click', () => { if (captionJob) void api.cancelTranscription(captionJob); });
$('captions-enabled').addEventListener('change', event => commit(draft => { draft.captionsEnabled = event.target.checked; }));
for (const format of ['srt', 'vtt']) $('export-'+format).addEventListener('click', () => api.exportSubtitles(subtitleText(project.captions, project.clips, format), format));
// A negative value means the recognizer is still being prepared.
api.onTranscriptionProgress(progress => { $('caption-progress').textContent = progress < 0 ? t('editor.captions.preparing') : t('editor.export.percent', { percent: Math.round(progress * 100) }); });
const presets = $('style-presets'); let savedPresets = [];
async function loadPresets() { savedPresets = await api.getPresets(); presets.replaceChildren(new Option(t('editor.presets.choose'), ''), ...savedPresets.map(x => new Option(x.name, x.id))); }
$('save-preset').addEventListener('click', async () => { const name = $('preset-name').value.trim(); if (!name) { $('preset-name').focus(); return; } await api.savePreset({ id: crypto.randomUUID(), name, look: project.look, exportChoice, isDefault: $('preset-default').checked }); $('preset-name').value = ''; await loadPresets(); });
presets.addEventListener('change', async () => { const preset = savedPresets.find(x => x.id === presets.value); if (!preset) return; commit(draft => { draft.look = normalizeLook(preset.look); }); if (preset.exportChoice) applyExportChoice(preset.exportChoice); if (preset.look.backgroundImage) { const url = await api.backgroundUrl(preset.look.backgroundImage); if (url) { const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url; await image.decode(); backgroundImage = image; showAt(playhead); } } });
$('delete-preset').addEventListener('click', async () => { if (!presets.value) return; await api.deletePreset(presets.value); await loadPresets(); });
captionUIReady = true; renderCaptions(); void loadPresets();
if (init.projectRecovered) showToast(t('editor.captions.recovered'));
if (init.exportChoice) applyExportChoice(init.exportChoice);

function applyExportChoice(value) { if (RESOLUTIONS.some(x => x.id === value.resolution)) exportChoice.resolution = value.resolution; if ([24, 30, 60].includes(value.fps)) exportChoice.fps = value.fps; if (QUALITIES.includes(value.quality)) exportChoice.quality = value.quality; }
