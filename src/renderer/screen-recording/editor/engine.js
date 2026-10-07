// Editor engine: turns a recording and its input log into an edited, framed,
// zoomed composition. Everything here is a pure function of the project and
// the time, so preview and export draw exactly the same frame for a moment.
//
// Times: "source" time is a position in the recorded video; "output" time is a
// position in the edited video, after cuts and speed changes. Zooms are kept in
// source time so they stay with their content when the edit changes; camera and
// pointer motion are computed in output time so they stay smooth across cuts.

export const BACKGROUNDS = {
  dusk: ['#ff8a3d', '#b43cc8'],
  ocean: ['#1d4ed8', '#06b6d4'],
  meadow: ['#15803d', '#a3e635'],
  graphite: ['#111827', '#4b5563'],
  paper: ['#f5efe6', '#dccfbd'],
  none: null
};
// Frame shapes. Anything but the original crops the recording to that shape,
// and the view follows the action inside it.
export const ASPECTS = { auto: null, wide: 16 / 9, classic: 4 / 3, square: 1, portrait: 4 / 5, tall: 9 / 16 };
export const SPEEDS = [0.5, 1, 1.5, 2, 3, 4];
export const CAMERA_SHAPES = ['circle', 'rounded', 'square'];
export const CAMERA_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const CLICK_SOUNDS = ['none', 'soft', 'crisp', 'pop'];
export const TYPING_SOUNDS = ['none', 'soft', 'mechanical', 'typewriter'];
export const KEY_SIZES = { small: 0.03, medium: 0.04, large: 0.052 };
export const KEY_POSITIONS = ['bottom', 'top'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Name of an image the user added as a background (stored by the app).
const IMAGE_ID = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const ZOOM_ID = /^[a-z0-9-]{1,40}$/;

export const DEFAULT_LOOK = Object.freeze({
  background: 'dusk',
  backgroundImage: null,
  padding: 0.07,
  radius: 0.018,
  shadow: true,
  aspect: 'auto',
  autoZoom: true,
  zoomScale: 2,
  smoothness: 0.5,
  clickEffects: true,
  cursorSize: 1.4,
  cursorSmoothing: 0.6,
  hideIdleCursor: true,
  motionBlur: true,
  shortcuts: true,
  showCamera: true,
  cameraShape: 'circle',
  cameraSize: 0.24,
  cameraPosition: 'bottom-right',
  cameraShrink: false,
  cameraRecorded: true,
  cameraMirror: true,
  clickSound: 'soft',
  clickVolume: 0.5,
  typingSound: 'soft',
  typingVolume: 0.35,
  keyColor: '#18181b',
  keySize: 'medium',
  keyPosition: 'bottom'
});

export const MIN_CLIP = 0.1;
export const MIN_ZOOM_LENGTH = 0.4;
export const MIN_ZOOM_SCALE = 1.1;
export const MAX_ZOOM_SCALE = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value) => typeof value === 'boolean';

// Accepts saved look settings, keeping only known, valid values.
export function normalizeLook(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const pick = (key, valid) => (valid(source[key]) ? source[key] : DEFAULT_LOOK[key]);
  const backgroundImage = typeof source.backgroundImage === 'string' && IMAGE_ID.test(source.backgroundImage) ? source.backgroundImage : null;
  const background = source.background === 'image' && backgroundImage !== null
    ? 'image'
    : pick('background', (value) => Object.hasOwn(BACKGROUNDS, value));
  return {
    background,
    backgroundImage,
    padding: clamp(pick('padding', isNumber), 0, 0.2),
    radius: clamp(pick('radius', isNumber), 0, 0.06),
    shadow: pick('shadow', isBoolean),
    aspect: pick('aspect', (value) => Object.hasOwn(ASPECTS, value)),
    autoZoom: pick('autoZoom', isBoolean),
    zoomScale: clamp(pick('zoomScale', isNumber), 1.2, 3.5),
    smoothness: clamp(pick('smoothness', isNumber), 0, 1),
    clickEffects: pick('clickEffects', isBoolean),
    cursorSize: clamp(pick('cursorSize', isNumber), 0.6, 3),
    cursorSmoothing: clamp(pick('cursorSmoothing', isNumber), 0, 1),
    hideIdleCursor: pick('hideIdleCursor', isBoolean),
    motionBlur: pick('motionBlur', isBoolean),
    shortcuts: pick('shortcuts', isBoolean),
    showCamera: pick('showCamera', isBoolean),
    cameraShape: pick('cameraShape', (value) => CAMERA_SHAPES.includes(value)),
    cameraSize: clamp(pick('cameraSize', isNumber), 0.01, 1),
    cameraPosition: pick('cameraPosition', (value) => CAMERA_POSITIONS.includes(value)),
    cameraShrink: false,
    cameraRecorded: pick('cameraRecorded', isBoolean),
    cameraMirror: pick('cameraMirror', isBoolean),
    clickSound: pick('clickSound', (value) => CLICK_SOUNDS.includes(value)),
    clickVolume: clamp(pick('clickVolume', isNumber), 0, 1),
    typingSound: pick('typingSound', (value) => TYPING_SOUNDS.includes(value)),
    typingVolume: clamp(pick('typingVolume', isNumber), 0, 1),
    keyColor: pick('keyColor', (value) => typeof value === 'string' && HEX_COLOR.test(value)).toLowerCase(),
    keySize: pick('keySize', (value) => Object.hasOwn(KEY_SIZES, value)),
    keyPosition: pick('keyPosition', (value) => KEY_POSITIONS.includes(value))
  };
}

// Kept source ranges in order, each with a playback speed. Overlaps and
// ranges outside the video are repaired rather than rejected.
export function normalizeClips(raw, rawDuration) {
  // An unknown length (a file still being read) is treated as empty.
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const clips = (Array.isArray(raw) ? raw : [])
    .filter((clip) => clip !== null && typeof clip === 'object' && isNumber(clip.start) && isNumber(clip.end))
    .map((clip) => ({
      start: clamp(clip.start, 0, duration),
      end: clamp(clip.end, 0, duration),
      speed: SPEEDS.includes(clip.speed) ? clip.speed : 1
    }))
    .filter((clip) => clip.end - clip.start >= MIN_CLIP)
    .sort((a, b) => a.start - b.start);
  const result = [];
  for (const clip of clips) {
    const previous = result[result.length - 1];
    if (previous !== undefined && clip.start < previous.end) {
      clip.start = previous.end;
      if (clip.end - clip.start < MIN_CLIP) continue;
    }
    result.push(clip);
  }
  return result.length > 0 ? result : [{ start: 0, end: duration, speed: 1 }];
}

export function normalizeZooms(raw, rawDuration) {
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  return (Array.isArray(raw) ? raw : [])
    .filter((zoom) => zoom !== null && typeof zoom === 'object' && typeof zoom.id === 'string' && ZOOM_ID.test(zoom.id)
      && [zoom.start, zoom.end, zoom.scale, zoom.x, zoom.y].every(isNumber))
    .map((zoom) => {
      const start = clamp(zoom.start, 0, duration);
      const end = clamp(zoom.end, 0, duration);
      return {
        id: zoom.id,
        start,
        end,
        scale: clamp(zoom.scale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE),
        x: clamp(zoom.x, 0, 1),
        y: clamp(zoom.y, 0, 1),
        follow: zoom.follow !== false,
        // Adjusted by hand, so it is kept when zooms are suggested again.
        edited: zoom.edited === true,
        focusAt: isNumber(zoom.focusAt) ? clamp(zoom.focusAt, start, end) : start
      };
    })
    .filter((zoom) => zoom.end - zoom.start >= MIN_ZOOM_LENGTH)
    .sort((a, b) => a.start - b.start);
}

// Reads a saved project (either version), planning zooms on first open.
export function normalizeProject(raw, duration, interactions, videoWidth = 1, videoHeight = 1) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  if (source.version === 2) {
    const look = normalizeLook(source.look);
    const zooms = Array.isArray(source.zooms)
      ? normalizeZooms(source.zooms, duration)
      : planZooms(interactions, duration, look, frameShape(videoWidth, videoHeight, look));
    return { look, clips: normalizeClips(source.clips, duration), zooms, captions: normalizeCaptionData(source.captions, duration), captionsEnabled: source.captionsEnabled === true };
  }
  // Version 1 kept one trim range and switched off planned zooms by id.
  const old = source.settings !== null && typeof source.settings === 'object' ? source.settings : {};
  const look = normalizeLook(old);
  const start = isNumber(old.trimStart) ? old.trimStart : 0;
  const end = isNumber(old.trimEnd) && old.trimEnd > 0 ? old.trimEnd : duration;
  const disabled = Array.isArray(old.disabledZooms) ? old.disabledZooms : [];
  const zooms = planZooms(interactions, duration, look, frameShape(videoWidth, videoHeight, look)).filter((zoom) => !disabled.includes(zoom.id));
  return { look, clips: normalizeClips([{ start, end, speed: 1 }], duration), zooms, captions: [], captionsEnabled: false };
}

// Converts the saved input log to seconds, dropping malformed entries.
export function normalizeInteractions(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const rows = (list, length) => (Array.isArray(list) ? list : [])
    .filter((entry) => Array.isArray(entry) && entry.length >= length && entry.slice(0, length).every(isNumber));
  const moves = rows(raw.moves, 3).map(([time, x, y]) => ({ t: time / 1000, x, y })).sort((a, b) => a.t - b.t);
  if (moves.length === 0) return null;
  const buttons = (list) => rows(list, 3)
    .map(([time, x, y, button]) => ({ t: time / 1000, x, y, button: isNumber(button) ? button : 0 }))
    .sort((a, b) => a.t - b.t);
  const keys = (Array.isArray(raw.keys) ? raw.keys : []).filter(isNumber).map((time) => time / 1000).sort((a, b) => a - b);
  // The recorded area in screen points; null when unknown.
  const rect = raw.rect !== null && typeof raw.rect === 'object' && isNumber(raw.rect.width) && raw.rect.width > 0 && isNumber(raw.rect.height) && raw.rect.height > 0
    ? { width: raw.rect.width, height: raw.rect.height }
    : null;
  const cursors = {};
  if (raw.cursors !== null && typeof raw.cursors === 'object') {
    for (const [id, image] of Object.entries(raw.cursors)) {
      if (image !== null && typeof image === 'object' && typeof image.png === 'string'
        && [image.w, image.h, image.hx, image.hy].every(isNumber) && image.w > 0 && image.h > 0) {
        cursors[id] = { png: image.png, w: image.w, h: image.h, hx: image.hx, hy: image.hy };
      }
    }
  }
  const cursorChanges = rows(raw.cursorChanges, 2)
    .map(([time, id]) => ({ t: time / 1000, id: String(id) }))
    .sort((a, b) => a.t - b.t);
  const shortcuts = (Array.isArray(raw.shortcuts) ? raw.shortcuts : [])
    .filter((entry) => Array.isArray(entry) && isNumber(entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 24)
    .map(([time, keys]) => ({ t: time / 1000, keys }))
    .sort((a, b) => a.t - b.t);
  const scrolls = rows(raw.scrolls, 5).map(([time, x, y, dx, dy]) => ({ t: time / 1000, x, y, dx, dy })).sort((a, b) => a.t - b.t);
  const hint = raw.cameraHint;
  const cameraHint = hint !== null && typeof hint === 'object' && CAMERA_POSITIONS.includes(hint.position) && isNumber(hint.size)
    ? { position: hint.position, size: clamp(hint.size, 0.01, 1), x: isNumber(hint.x) ? hint.x : null, y: isNumber(hint.y) ? hint.y : null }
    : null;
  return {
    moves,
    cameraHint,
    cameraLayouts: rows(raw.cameraLayouts, 4).map(([time, x, y, size]) => ({ t: time / 1000, x, y, size: clamp(size, 0.01, 1) })).sort((a, b) => a.t - b.t),
    clicks: buttons(raw.clicks),
    releases: buttons(raw.releases),
    scrolls,
    keys,
    shortcuts,
    rect,
    cursorHidden: raw.cursorHidden === true,
    cursors,
    cursorChanges
  };
}

function lastIndexAtOrBefore(list, time) {
  let low = 0;
  let high = list.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle].t <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// Pointer position at a source time, interpolated between samples.
export function cursorAt(moves, time) {
  if (moves.length === 0) return { x: 0.5, y: 0.5 };
  const index = lastIndexAtOrBefore(moves, time);
  if (index === -1) return moves[0];
  if (index === moves.length - 1) return moves[index];
  const a = moves[index];
  const b = moves[index + 1];
  const mix = (time - a.t) / Math.max(1e-6, b.t - a.t);
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
}

// Which pointer image (arrow, hand, text beam...) was showing at a source time.
export function cursorImageAt(interactions, time) {
  const index = lastIndexAtOrBefore(interactions.cursorChanges, time);
  if (index !== -1) return interactions.cursorChanges[index].id;
  return interactions.cursorChanges[0]?.id ?? null;
}

// ---- Time mapping -------------------------------------------------------

export function clipLength(clip) {
  return (clip.end - clip.start) / clip.speed;
}

export function outputDuration(clips) {
  return clips.reduce((sum, clip) => sum + clipLength(clip), 0);
}

// Output time where each clip begins.
export function clipOffsets(clips) {
  const offsets = [];
  let total = 0;
  for (const clip of clips) {
    offsets.push(total);
    total += clipLength(clip);
  }
  return offsets;
}

// Source time shown at an output time, and which clip it belongs to.
export function sourceAt(clips, offsets, time) {
  let index = clips.length - 1;
  for (let i = 0; i < clips.length; i += 1) {
    if (time < offsets[i] + clipLength(clips[i])) {
      index = i;
      break;
    }
  }
  const clip = clips[index];
  const local = clamp(time - offsets[index], 0, clipLength(clip));
  return { time: Math.min(clip.end, clip.start + local * clip.speed), index };
}

// sourceAt for output times that only increase, in constant time per call.
function timelineWalker(clips, offsets) {
  let index = 0;
  return (time) => {
    while (index < clips.length - 1 && time >= offsets[index] + clipLength(clips[index])) index += 1;
    const clip = clips[index];
    const local = clamp(time - offsets[index], 0, clipLength(clip));
    return { time: Math.min(clip.end, clip.start + local * clip.speed), index };
  };
}

// Output time of a source time, or null when that moment was cut.
export function outputAt(clips, offsets, time) {
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    if (time >= clip.start && time <= clip.end) return offsets[i] + (time - clip.start) / clip.speed;
  }
  return null;
}

// ---- Automatic zooms ----------------------------------------------------

const CLUSTER_GAP = 2.6;
const TYPING_GAP = 1.2;
const TYPING_MIN_KEYS = 4;
const TYPING_CONTEXT = 12;
const DRAG_DISTANCE = 0.03;
const LEAD_IN = 0.9;
const HOLD_OUT = 1.6;
const MIN_AUTO_ZOOM = 1.8;
const MERGE_GAP = 1.2;
const MAX_ZOOM_SPAN = 12;
const FIT_MARGIN = 0.22;
const SCROLL_SCALE = 1.4;

const inside = (point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

// The moments worth a closer look, with where they happen: clicks, both ends
// of drags, and stretches of typing (framed where the last click placed the
// caret, or at the pointer).
function activityMoments(interactions) {
  const moments = [];
  const { clicks, releases } = interactions;
  let releaseIndex = 0;
  clicks.forEach((click, index) => {
    // Its own release comes before the next press of the same button.
    while (releaseIndex < releases.length && releases[releaseIndex].t < click.t) releaseIndex += 1;
    const next = clicks.slice(index + 1).find((entry) => entry.button === click.button);
    let release;
    for (let i = releaseIndex; i < releases.length && (next === undefined || releases[i].t <= next.t); i += 1) {
      if (releases[i].button === click.button) {
        release = releases[i];
        break;
      }
    }
    if (!inside(click)) return;
    moments.push({ t: click.t, x: click.x, y: click.y });
    if (release !== undefined && inside(release) && Math.hypot(release.x - click.x, release.y - click.y) > DRAG_DISTANCE) {
      moments.push({ t: release.t, x: release.x, y: release.y });
    }
  });

  let burst = [];
  const closeBurst = () => {
    if (burst.length >= TYPING_MIN_KEYS) {
      const start = burst[0];
      const lastClick = interactions.clicks[lastIndexAtOrBefore(interactions.clicks, start)];
      const at = lastClick !== undefined && start - lastClick.t <= TYPING_CONTEXT ? lastClick : cursorAt(interactions.moves, start);
      if (inside(at)) {
        moments.push({ t: start, x: at.x, y: at.y });
        moments.push({ t: burst[burst.length - 1], x: at.x, y: at.y });
      }
    }
    burst = [];
  };
  for (const time of interactions.keys) {
    if (burst.length > 0 && time - burst[burst.length - 1] > TYPING_GAP) closeBurst();
    burst.push(time);
  }
  closeBurst();
  return moments.sort((a, b) => a.t - b.t);
}

// Groups nearby moments into zooms. Each zoom is framed to fit the area its
// moments cover, up to the chosen zoom level, and stays wider while scrolling.
// Levels are relative to the frame's own view (`shape`: the part of the
// recording it shows unzoomed), so a narrow frame needs less zoom to fit.
export function planZooms(interactions, duration, look, shape = FULL_SHAPE) {
  if (interactions === null || !Number.isFinite(duration) || !(duration > 0)) return [];
  // Groups of moments close in time; nearby groups share one zoom.
  const groups = [];
  for (const moment of activityMoments(interactions)) {
    if (moment.t < 0 || moment.t > duration) continue;
    const last = groups[groups.length - 1];
    const lastEnd = last === undefined ? -Infinity : Math.min(duration, last[last.length - 1].t + HOLD_OUT);
    const start = Math.max(0, moment.t - LEAD_IN);
    // Long stretches of activity are split so each zoom frames one part of it.
    const fits = last !== undefined && moment.t - last[0].t <= MAX_ZOOM_SPAN;
    if (fits && (moment.t - last[last.length - 1].t <= CLUSTER_GAP || start - lastEnd < MERGE_GAP)) last.push(moment);
    else groups.push([moment]);
  }

  const zooms = groups.map((group) => {
    const first = group[0].t;
    let start = Math.max(0, first - LEAD_IN);
    let end = Math.min(duration, group[group.length - 1].t + HOLD_OUT);
    if (end - start < MIN_AUTO_ZOOM) end = Math.min(duration, start + MIN_AUTO_ZOOM);
    if (end - start < MIN_AUTO_ZOOM) start = Math.max(0, end - MIN_AUTO_ZOOM);
    const xs = group.map((moment) => moment.x);
    const ys = group.map((moment) => moment.y);
    const spread = Math.max((Math.max(...xs) - Math.min(...xs)) / shape.fx, (Math.max(...ys) - Math.min(...ys)) / shape.fy);
    const scrolled = interactions.scrolls.some((scroll) => scroll.t >= start && scroll.t <= end);
    let scale = clamp(1 / (spread + FIT_MARGIN), MIN_ZOOM_SCALE, look.zoomScale);
    if (scrolled) scale = Math.min(scale, SCROLL_SCALE);
    return {
      id: `z${Math.round(first * 1000)}`,
      start,
      end,
      scale: Math.round(scale * 100) / 100,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      follow: true,
      focusAt: first
    };
  });
  // Neighbouring zooms meet halfway between their activity instead of overlapping.
  for (let i = 1; i < zooms.length; i += 1) {
    const previous = zooms[i - 1];
    const zoom = zooms[i];
    if (zoom.start < previous.end) {
      const split = (previous.end + zoom.start) / 2;
      previous.end = split;
      zoom.start = split;
    }
  }
  // The same rules as saved zooms: within the video, long enough, focus inside.
  return normalizeZooms(zooms, duration);
}

// ---- Camera and pointer motion -----------------------------------------

export const STEP = 1 / 120;

function springStep(state, target, omega) {
  // Critically damped: settles quickly without overshooting text.
  const acceleration = omega * omega * (target - state.value) - 2 * omega * state.velocity;
  state.velocity += acceleration * STEP;
  state.value += state.velocity * STEP;
}

// Tracks cover the edited video; an unusable length gives an empty track.
function trackLength(clips) {
  const total = outputDuration(clips);
  return Number.isFinite(total) && total > 0 ? Math.ceil(total / STEP) + 2 : 2;
}

// Precomputes the camera (scale and center) over the edited video, so any
// moment can be sampled in any order and always gives the same framing. When
// the frame shows only part of the recording, the view follows the action
// even without a zoom.
export function buildCameraTrack(interactions, zooms, clips, look, shape = FULL_SHAPE) {
  const offsets = clipOffsets(clips);
  const count = trackLength(clips);
  const track = new Float32Array(count * 3);
  const active = look.autoZoom ? zooms : [];
  const omega = 11 - 7 * look.smoothness;
  const scale = { value: 1, velocity: 0 };
  const cx = { value: 0.5, velocity: 0 };
  const cy = { value: 0.5, velocity: 0 };
  const cropped = shape.fx < 0.999 || shape.fy < 0.999;
  const start = interactions !== null && cropped ? cursorAt(interactions.moves, 0) : { x: 0.5, y: 0.5 };
  let focusX = start.x;
  let focusY = start.y;
  cx.value = start.x;
  cy.value = start.y;

  // Moves the focus only as far as needed to keep the pointer in the calm
  // middle of the view.
  const follow = (source, reachX, reachY) => {
    const pointer = cursorAt(interactions.moves, source);
    if (pointer.x > focusX + reachX) focusX = pointer.x - reachX;
    if (pointer.x < focusX - reachX) focusX = pointer.x + reachX;
    if (pointer.y > focusY + reachY) focusY = pointer.y - reachY;
    if (pointer.y < focusY - reachY) focusY = pointer.y + reachY;
  };

  // Source time only moves forward along the edit, so the current clip and
  // zoom are found by stepping forward instead of searching every time.
  const walk = timelineWalker(clips, offsets);
  let zoomIndex = 0;
  for (let step = 0; step < count; step += 1) {
    const { time: source } = walk(step * STEP);
    while (zoomIndex < active.length && active[zoomIndex].end <= source) zoomIndex += 1;
    const candidate = active[zoomIndex];
    const zoom = candidate !== undefined && candidate.start <= source ? candidate : null;
    const targetScale = zoom === null ? 1 : zoom.scale;
    if (zoom === null) {
      if (cropped && interactions !== null) {
        follow(source, 0.3 * shape.fx, 0.3 * shape.fy);
      } else {
        focusX = 0.5;
        focusY = 0.5;
      }
    } else if (!zoom.follow || source < zoom.focusAt || interactions === null) {
      // Arrive at the planned spot before the action happens.
      focusX = zoom.x;
      focusY = zoom.y;
    } else {
      follow(source, (0.3 * shape.fx) / targetScale, (0.3 * shape.fy) / targetScale);
    }

    springStep(scale, targetScale, omega);
    springStep(cx, focusX, omega * 0.9);
    springStep(cy, focusY, omega * 0.9);
    const s = Math.max(1, scale.value);
    const halfX = shape.fx / (2 * s);
    const halfY = shape.fy / (2 * s);
    track[step * 3] = s;
    track[step * 3 + 1] = clamp(cx.value, halfX, 1 - halfX);
    track[step * 3 + 2] = clamp(cy.value, halfY, 1 - halfY);
  }
  return track;
}

const IDLE_SECONDS = 1.8;
const IDLE_FADE = 0.3;
const CLICK_ANCHOR = 0.12;

// Precomputes the drawn pointer over the edited video: a smoothed path that
// still lands exactly on each click and jumps cleanly at cuts, and an opacity
// that fades out while the pointer rests.
export function buildCursorTrack(interactions, clips, look) {
  const offsets = clipOffsets(clips);
  const count = trackLength(clips);
  const track = new Float32Array(count * 3);
  if (interactions === null) return track;
  const omega = 60 - 50 * look.cursorSmoothing;
  const x = { value: 0, velocity: 0 };
  const y = { value: 0, velocity: 0 };
  let clipIndex = -1;

  const walk = timelineWalker(clips, offsets);
  for (let step = 0; step < count; step += 1) {
    const { time: source, index } = walk(step * STEP);
    const raw = cursorAt(interactions.moves, source);
    if (index !== clipIndex) {
      clipIndex = index;
      x.value = raw.x;
      y.value = raw.y;
      x.velocity = 0;
      y.velocity = 0;
    }
    springStep(x, raw.x, omega);
    springStep(y, raw.y, omega);
    const click = interactions.clicks[lastIndexAtOrBefore(interactions.clicks, source + CLICK_ANCHOR)];
    if (click !== undefined && Math.abs(click.t - source) <= CLICK_ANCHOR) {
      // Near a click, pull onto the real position so the click lands on target.
      x.value += (raw.x - x.value) * 0.35;
      y.value += (raw.y - y.value) * 0.35;
    }
    const moveIndex = lastIndexAtOrBefore(interactions.moves, source);
    let lastActive = moveIndex === -1 ? 0 : interactions.moves[moveIndex].t;
    if (click !== undefined && click.t <= source) lastActive = Math.max(lastActive, click.t);
    const idle = source - lastActive - IDLE_SECONDS;
    const alpha = look.hideIdleCursor && idle > 0 ? Math.max(0, 1 - idle / IDLE_FADE) : 1;
    track[step * 3] = x.value;
    track[step * 3 + 1] = y.value;
    track[step * 3 + 2] = alpha;
  }
  return track;
}

function sampleTrack(track, time) {
  const count = track.length / 3;
  const position = clamp(time / STEP, 0, count - 1);
  const low = Math.floor(position);
  const high = Math.min(count - 1, low + 1);
  const mix = position - low;
  return (offset) => track[low * 3 + offset] + (track[high * 3 + offset] - track[low * 3 + offset]) * mix;
}

export function cameraAt(track, time) {
  const read = sampleTrack(track, time);
  return { scale: read(0), x: read(1), y: read(2) };
}

export function cursorTrackAt(track, time) {
  const read = sampleTrack(track, time);
  return { x: read(0), y: read(1), alpha: read(2) };
}

// Camera and pointer at an output time, plus where they were one blur frame
// earlier. Motion blur never reaches back across a cut, where the picture jumps.
export function motionAt(cameraTrack, cursorTrack, clips, offsets, time, blurFrame) {
  const before = Math.max(0, time - blurFrame);
  const sameClip = sourceAt(clips, offsets, before).index === sourceAt(clips, offsets, time).index;
  return {
    camera: cameraAt(cameraTrack, time),
    previousCamera: sameClip ? cameraAt(cameraTrack, before) : null,
    cursor: cursorTrackAt(cursorTrack, time),
    previousCursor: sameClip ? cursorTrackAt(cursorTrack, before) : null
  };
}

// Clicks, key presses and shortcuts placed on the edited timeline (cut ones
// are dropped). Key presses include shortcuts, for typing sounds.
export function outputEvents(interactions, clips) {
  if (interactions === null) return { clicks: [], shortcuts: [], keys: [] };
  const offsets = clipOffsets(clips);
  const place = (list) => list
    .map((entry) => ({ ...entry, source: entry.t, t: outputAt(clips, offsets, entry.t) }))
    .filter((entry) => entry.t !== null);
  const presses = [...interactions.keys.map((t) => ({ t })), ...interactions.shortcuts.map((entry) => ({ t: entry.t }))].sort((a, b) => a.t - b.t);
  return { clicks: place(interactions.clicks), shortcuts: place(interactions.shortcuts), keys: place(presses) };
}

// ---- Layout and drawing -------------------------------------------------

const MAX_OUTPUT_SIDE = 3840;
const even = (value) => Math.max(2, Math.round(value / 2) * 2);

// Output size for the chosen shape. Other shapes keep about as many pixels as
// the recording, so a 1920×1080 recording in 9:16 becomes 1080×1920. With a
// `shortSide` (1440 means the short side is 1440 pixels) the size is scaled
// to it, up or down; the long side never exceeds 3840.
export function outputSize(videoWidth, videoHeight, aspect, shortSide = Infinity) {
  if (!(videoWidth > 0 && videoHeight > 0)) return { width: 2, height: 2 };
  const ratio = ASPECTS[aspect] ?? null;
  let width = videoWidth;
  let height = videoHeight;
  if (ratio !== null) {
    const area = videoWidth * videoHeight;
    width = Math.sqrt(area * ratio);
    height = Math.sqrt(area / ratio);
  }
  const target = Number.isFinite(shortSide) ? shortSide / Math.min(width, height) : 1;
  const fit = Math.min(target, MAX_OUTPUT_SIDE / Math.max(width, height));
  return { width: even(width * fit), height: even(height * fit) };
}

// Where the video sits inside the output frame. The original shape keeps the
// whole recording; other shapes fill the frame inside the padding.
export function contentBox(output, videoWidth, videoHeight, look) {
  const framed = look.background !== 'none';
  const inset = framed ? look.padding * Math.min(output.width, output.height) : 0;
  const boxWidth = Math.max(2, output.width - inset * 2);
  const boxHeight = Math.max(2, output.height - inset * 2);
  let width = boxWidth;
  let height = boxHeight;
  if ((ASPECTS[look.aspect] === null || ASPECTS[look.aspect] === undefined) && videoWidth > 0 && videoHeight > 0) {
    const fit = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
    width = videoWidth * fit;
    height = videoHeight * fit;
  }
  return {
    x: (output.width - width) / 2,
    y: (output.height - height) / 2,
    width,
    height,
    radius: framed ? look.radius * Math.min(output.width, output.height) : 0
  };
}

export const FULL_SHAPE = Object.freeze({ fx: 1, fy: 1 });

// The part of the recording a box shows when not zoomed, as fractions of its
// width and height: the largest area with the box's shape.
function shapeForBox(box, videoWidth, videoHeight) {
  if (!(videoWidth > 0 && videoHeight > 0 && box.width > 0 && box.height > 0)) return FULL_SHAPE;
  const boxRatio = box.width / box.height;
  const videoRatio = videoWidth / videoHeight;
  if (Math.abs(boxRatio - videoRatio) < 1e-3) return FULL_SHAPE;
  return boxRatio < videoRatio
    ? { fx: boxRatio / videoRatio, fy: 1 }
    : { fx: 1, fy: videoRatio / boxRatio };
}

export function frameShape(videoWidth, videoHeight, look) {
  const output = outputSize(videoWidth, videoHeight, look.aspect);
  return shapeForBox(contentBox(output, videoWidth, videoHeight, look), videoWidth, videoHeight);
}

function roundedRect(context, box) {
  context.beginPath();
  context.roundRect(box.x, box.y, box.width, box.height, box.radius);
}

function viewport(camera, videoWidth, videoHeight, shape) {
  const width = (videoWidth * shape.fx) / camera.scale;
  const height = (videoHeight * shape.fy) / camera.scale;
  return { x: camera.x * videoWidth - width / 2, y: camera.y * videoHeight - height / 2, width, height };
}

// How far the picture moves on screen between two camera states, in pixels.
function cameraShift(from, to, box, shape) {
  const pan = Math.hypot(((to.x - from.x) * box.width * to.scale) / shape.fx, ((to.y - from.y) * box.height * to.scale) / shape.fy);
  const zoom = (Math.abs(to.scale - from.scale) / to.scale) * Math.hypot(box.width, box.height) / 2;
  return pan + zoom;
}

const RIPPLE_SECONDS = 0.55;
const BLUR_MIN_SHIFT = 2;
const BLUR_MAX_SAMPLES = 6;
const CLICK_PRESS_SECONDS = 0.18;
const SHORTCUT_SECONDS = 1.3;
const SHORTCUT_FADE = 0.15;

function drawBackground(context, frame, width, height) {
  const { look } = frame;
  const image = look.background === 'image' ? frame.backgroundImage ?? null : null;
  const colors = look.background === 'image' ? null : BACKGROUNDS[look.background];
  if (image !== null) {
    // Cover the whole frame, cropping the image's longer side.
    const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * cover;
    const drawHeight = image.naturalHeight * cover;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else if (colors === null || colors === undefined) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
  } else {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
}

// Draws one output frame at `frame.time` (output time).
export function drawFrame(context, frame) {
  const { video, videoWidth, videoHeight, look, camera, interactions } = frame;
  const { width, height } = context.canvas;
  const box = contentBox({ width, height }, videoWidth, videoHeight, look);
  drawBackground(context, frame, width, height);

  if (look.background !== 'none' && look.shadow) {
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.38)';
    context.shadowBlur = Math.min(width, height) * 0.04;
    context.shadowOffsetY = Math.min(width, height) * 0.012;
    context.fillStyle = '#000';
    roundedRect(context, box);
    context.fill();
    context.restore();
  }

  const shape = shapeForBox(box, videoWidth, videoHeight);
  const view = viewport(camera, videoWidth, videoHeight, shape);
  context.save();
  roundedRect(context, box);
  context.clip();
  if (video !== null) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const previous = look.motionBlur ? frame.previousCamera ?? null : null;
    const shift = previous === null ? 0 : cameraShift(previous, camera, box, shape);
    if (shift < BLUR_MIN_SHIFT) {
      context.drawImage(video, view.x, view.y, view.width, view.height, box.x, box.y, box.width, box.height);
    } else {
      // Average a few in-between views along the camera's path this frame.
      const samples = Math.min(BLUR_MAX_SAMPLES, Math.ceil(shift / BLUR_MIN_SHIFT));
      for (let index = 0; index < samples; index += 1) {
        const mix = samples === 1 ? 1 : index / (samples - 1);
        const between = viewport({
          scale: previous.scale + (camera.scale - previous.scale) * mix,
          x: previous.x + (camera.x - previous.x) * mix,
          y: previous.y + (camera.y - previous.y) * mix
        }, videoWidth, videoHeight, shape);
        context.globalAlpha = 1 / (index + 1);
        context.drawImage(video, between.x, between.y, between.width, between.height, box.x, box.y, box.width, box.height);
      }
      context.globalAlpha = 1;
    }
  }

  const place = (point) => ({
    x: box.x + ((point.x * videoWidth - view.x) / view.width) * box.width,
    y: box.y + ((point.y * videoHeight - view.y) / view.height) * box.height
  });

  const events = frame.events ?? { clicks: [], shortcuts: [] };
  if (look.clickEffects) {
    const unit = Math.min(box.width, box.height);
    for (const click of events.clicks) {
      const age = frame.time - click.t;
      if (age < 0 || age > RIPPLE_SECONDS) continue;
      const progress = age / RIPPLE_SECONDS;
      const eased = 1 - (1 - progress) ** 3;
      const at = place(click);
      context.beginPath();
      context.arc(at.x, at.y, unit * (0.012 + 0.03 * eased) * Math.sqrt(camera.scale), 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 255, 255, ${0.28 * (1 - progress)})`;
      context.strokeStyle = `rgba(255, 255, 255, ${0.85 * (1 - progress)})`;
      context.lineWidth = Math.max(1.5, unit * 0.003);
      context.fill();
      context.stroke();
    }
  }

  if (interactions !== null && interactions.cursorHidden && frame.cursor !== undefined && frame.cursor.alpha > 0.01) {
    drawCursor(context, frame, box, view, place, events);
  }
  context.restore();

  if (frame.cameraVideo && look.showCamera) drawCamera(context, frame, width, height);
  if (look.shortcuts) drawShortcut(context, frame, events, width, height);
  if (frame.captionsEnabled) drawCaption(context, frame.captions ?? [], frame.sourceTime);
}

const CAMERA_MARGIN = 0.035;
// Face cam placement is relative to the captured content, independent of zoom.
export function cameraBox(look, width, height, zoomScale, content = { x: 0, y: 0, width, height }, layout = null) {
  const unit = Math.min(content.width, content.height);
  const size = (layout?.size ?? look.cameraSize) * unit;
  const margin = CAMERA_MARGIN * unit;
  const right = look.cameraPosition.endsWith('right');
  const bottom = look.cameraPosition.startsWith('bottom');
  return {
    x: content.x + (layout ? layout.x * content.width : right ? content.width - margin - size : margin),
    y: content.y + (layout ? layout.y * content.height : bottom ? content.height - margin - size : margin),
    size,
    radius: look.cameraShape === 'circle' ? size / 2 : look.cameraShape === 'rounded' ? size * 0.22 : size * 0.06
  };
}

export function recordedCameraLayout(interactions, time, look) {
  if (!look.cameraRecorded || !interactions) return null;
  const layouts = interactions.cameraLayouts ?? [];
  let low = 0;
  let high = layouts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (layouts[mid].t <= time) low = mid + 1;
    else high = mid;
  }
  const hint = interactions.cameraHint;
  const layout = layouts[Math.max(0, low - 1)] ?? (hint && isNumber(hint.x) && isNumber(hint.y) ? hint : null);
  if (!layout) return null;
  return { ...layout, size: layout.size * look.cameraSize / (hint?.size || layout.size) };
}

function drawCamera(context, frame, width, height) {
  const { look, cameraVideo, cameraWidth, cameraHeight, camera } = frame;
  const content = contentBox({ width, height }, frame.videoWidth, frame.videoHeight, look);
  const layout = recordedCameraLayout(frame.interactions, frame.sourceTime ?? frame.time, look);
  const box = cameraBox(look, width, height, camera.scale, content, layout);
  // Fill the shape with the middle of the picture.
  const side = Math.min(cameraWidth, cameraHeight);
  const sx = (cameraWidth - side) / 2;
  const sy = (cameraHeight - side) / 2;
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = box.size * 0.08;
  context.shadowOffsetY = box.size * 0.02;
  context.fillStyle = '#000';
  context.beginPath();
  context.roundRect(box.x, box.y, box.size, box.size, box.radius);
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.roundRect(box.x, box.y, box.size, box.size, box.radius);
  context.clip();
  context.imageSmoothingQuality = 'high';
  if (look.cameraMirror) {
    context.translate(box.x * 2 + box.size, 0);
    context.scale(-1, 1);
  }
  context.drawImage(cameraVideo, sx, sy, side, side, box.x, box.y, box.size, box.size);
  context.restore();

  context.save();
  context.beginPath();
  context.roundRect(box.x, box.y, box.size, box.size, box.radius);
  context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  context.lineWidth = Math.max(1, box.size * 0.008);
  context.stroke();
  context.restore();
}

// A plain arrow for recordings where the pointer's look is unknown.
function drawArrow(context, size) {
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, size * 0.72);
  context.lineTo(size * 0.2, size * 0.56);
  context.lineTo(size * 0.33, size * 0.84);
  context.lineTo(size * 0.44, size * 0.79);
  context.lineTo(size * 0.31, size * 0.52);
  context.lineTo(size * 0.52, size * 0.52);
  context.closePath();
  context.fillStyle = '#000';
  context.strokeStyle = '#fff';
  context.lineWidth = size * 0.06;
  context.lineJoin = 'round';
  context.stroke();
  context.fill();
}

// Draws the pointer over the video, sized around its hotspot so enlarging it
// never moves the point that clicks.
function drawCursor(context, frame, box, view, place, events) {
  const { look, interactions, videoWidth, cursor } = frame;
  // Output pixels per screen point at this zoom (a point is a video pixel when the area is unknown).
  const perPoint = (box.width / view.width) * (interactions.rect === null ? 1 : videoWidth / interactions.rect.width);
  const id = cursorImageAt(interactions, frame.sourceTime ?? frame.time);
  const sprite = id === null ? null : interactions.cursors[id] ?? null;
  const image = id === null ? null : frame.cursorImages?.get(id) ?? null;

  let press = 1;
  for (const click of events.clicks) {
    const age = frame.time - click.t;
    if (age >= 0 && age < CLICK_PRESS_SECONDS) press = 1 - 0.18 * Math.sin((age / CLICK_PRESS_SECONDS) * Math.PI);
  }
  const scale = look.cursorSize * press * perPoint;

  const draw = (point, alpha) => {
    const at = place(point);
    context.save();
    context.globalAlpha = alpha;
    context.translate(at.x, at.y);
    context.scale(scale, scale);
    context.shadowColor = 'rgba(0, 0, 0, 0.3)';
    context.shadowBlur = 3 * scale;
    context.shadowOffsetY = scale;
    if (sprite !== null && image !== null && image.complete) {
      context.drawImage(image, -sprite.hx, -sprite.hy, sprite.w, sprite.h);
    } else {
      drawArrow(context, 22);
    }
    context.restore();
  };

  const previous = look.motionBlur ? frame.previousCursor ?? null : null;
  const from = previous === null ? null : place(previous);
  const to = place(cursor);
  const travel = from === null ? 0 : Math.hypot(to.x - from.x, to.y - from.y);
  if (travel < BLUR_MIN_SHIFT * 3) {
    draw(cursor, cursor.alpha);
    return;
  }
  // A fast pointer leaves a short, fading trail along its path.
  const samples = Math.min(BLUR_MAX_SAMPLES, Math.ceil(travel / (BLUR_MIN_SHIFT * 3)));
  for (let index = 0; index < samples; index += 1) {
    const mix = (index + 1) / samples;
    const point = { x: previous.x + (cursor.x - previous.x) * mix, y: previous.y + (cursor.y - previous.y) * mix };
    draw(point, cursor.alpha * (index === samples - 1 ? 1 : 0.35 * mix));
  }
}

// Perceived brightness of a #rrggbb color, from 0 (black) to 1 (white).
export function relativeLuminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// Splits a shortcut like ⌘⇧S into its keys: modifiers, then the key name.
export function shortcutKeys(keys) {
  const modifiers = [];
  let rest = keys;
  while (rest.length > 0 && '⌃⌥⇧⌘'.includes(rest[0])) {
    modifiers.push(rest[0]);
    rest = rest.slice(1);
  }
  return rest.length > 0 ? [...modifiers, rest] : modifiers;
}

// Shows the latest shortcut as key caps near the bottom of the frame.
function drawShortcut(context, frame, events, width, height) {
  let shown = null;
  for (const shortcut of events.shortcuts) {
    const age = frame.time - shortcut.t;
    if (age >= 0 && age <= SHORTCUT_SECONDS) shown = { keys: shortcutKeys(shortcut.keys), age };
  }
  if (shown === null || shown.keys.length === 0) return;
  const fade = Math.max(0, Math.min(1, shown.age / SHORTCUT_FADE, (SHORTCUT_SECONDS - shown.age) / SHORTCUT_FADE));
  const look = frame.look;
  const unit = Math.min(width, height);
  const fontSize = unit * (KEY_SIZES[look.keySize] ?? KEY_SIZES.medium);
  const gap = fontSize * 0.3;
  const capHeight = fontSize * 1.9;
  context.save();
  context.globalAlpha = fade;
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif`;
  const widths = shown.keys.map((key) => Math.max(capHeight, context.measureText(key).width + fontSize * 1.1));
  const total = widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1);
  let x = (width - total) / 2;
  const slide = (1 - fade) * fontSize * 0.4;
  const y = look.keyPosition === 'top' ? unit * 0.05 - slide : height - unit * 0.05 - capHeight + slide;
  const light = relativeLuminance(look.keyColor) > 0.45;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  shown.keys.forEach((key, index) => {
    context.globalAlpha = fade * 0.92;
    context.fillStyle = look.keyColor;
    context.strokeStyle = light ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = Math.max(1, fontSize * 0.05);
    context.beginPath();
    context.roundRect(x, y, widths[index], capHeight, fontSize * 0.4);
    context.fill();
    context.stroke();
    context.globalAlpha = fade;
    context.fillStyle = light ? '#111114' : '#ffffff';
    context.fillText(key, x + widths[index] / 2, y + capHeight / 2 + fontSize * 0.04);
    x += widths[index] + gap;
  });
  context.restore();
}

function normalizeCaptionData(value, duration) {
  const entries = (Array.isArray(value) ? value : []).filter(x => x && Number.isFinite(x.start) && Number.isFinite(x.end) && typeof x.text === 'string').sort((a, b) => a.start - b.start).slice(0, 20000);
  const result = [];
  for (const entry of entries) { const start = Math.max(0, entry.start, result.at(-1)?.end ?? 0); const end = Math.min(duration, entry.end); if (end > start && entry.text.trim()) result.push({ start, end, text: entry.text.trim().slice(0, 2000) }); }
  return result;
}
function drawCaption(context, captions, time) {
  let low = 0, high = captions.length;
  while (low < high) { const mid = (low + high) >>> 1; if (captions[mid].start <= time) low = mid + 1; else high = mid; }
  const caption = captions[low - 1]; if (!caption || caption.end <= time) return;
  const { width, height } = context.canvas; const size = Math.max(14, Math.min(width, height) * 0.04);
  context.save(); context.font = `600 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle';
  const lines = []; let line = '';
  for (const word of caption.text.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (line && context.measureText(next).width > width * 0.8) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); const visible = lines.slice(0, 3); const boxHeight = visible.length * size * 1.3 + size;
  context.fillStyle = 'rgba(0,0,0,0.88)'; context.beginPath(); context.roundRect(width * 0.07, height * 0.9 - boxHeight, width * 0.86, boxHeight, size * 0.3); context.fill();
  context.fillStyle = '#ffffff'; visible.forEach((text, index) => context.fillText(text, width / 2, height * 0.9 - boxHeight + size * 1.1 + index * size * 1.3, width * 0.8)); context.restore();
}
