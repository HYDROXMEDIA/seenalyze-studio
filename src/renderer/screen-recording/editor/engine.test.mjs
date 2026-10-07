// Tests the editor engine: project reading, time mapping, zoom planning,
// camera and pointer motion, and layout.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import * as audio from './audio.js';
import * as engine from './engine.js';
import * as sounds from './sounds.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

const log = engine.normalizeInteractions({
  version: 2,
  rect: { x: 0, y: 0, width: 1440, height: 900 },
  moves: [[0, 0.5, 0.5], [2000, 0.2, 0.3], [6000, 0.8, 0.7], [12000, 0.8, 0.7]],
  clicks: [[2100, 0.2, 0.3, 0], [3000, 0.24, 0.32, 0], [9000, 0.8, 0.7, 0], [9500, 1.4, 0.7, 0]],
  releases: [[2150, 0.2, 0.3, 0], [3050, 0.24, 0.32, 0], [9400, 0.6, 0.5, 0]],
  scrolls: [],
  keys: [10000, 10200, 10400, 10600, 10800],
  shortcuts: [[11000, '⌘⇧S'], [11500, 'bad but short']],
  cursorHidden: true,
  cursors: { 0: { png: 'AA==', w: 17, h: 23, hx: 4, hy: 3 }, bad: { png: 1 } },
  cursorChanges: [[0, 0], [5000, 1]]
});

test('reads both log versions and drops malformed entries', () => {
  assert.equal(log.cursorHidden, true);
  assert.deepEqual(Object.keys(log.cursors), ['0']);
  assert.equal(engine.cursorImageAt(log, 1), '0');
  assert.equal(engine.cursorImageAt(log, 6), '1');
  assert.equal(log.clicks[0].button, 0);
  const old = engine.normalizeInteractions({ moves: [[0, 0.1, 0.1]], clicks: [[100, 0.1, 0.1]], keys: [] });
  assert.equal(old.clicks.length, 1);
  assert.equal(old.releases.length, 0);
  assert.equal(engine.normalizeInteractions({ moves: [] }), null);
});

test('interpolates the pointer between samples', () => {
  const at = engine.cursorAt(log.moves, 4);
  close(at.x, 0.5);
  close(at.y, 0.5);
});

test('maps output time to source time across cuts and speed changes', () => {
  const clips = engine.normalizeClips([{ start: 0, end: 2, speed: 1 }, { start: 4, end: 8, speed: 2 }], 12);
  const offsets = engine.clipOffsets(clips);
  close(engine.outputDuration(clips), 4);
  close(engine.sourceAt(clips, offsets, 1).time, 1);
  close(engine.sourceAt(clips, offsets, 3).time, 6);
  assert.equal(engine.sourceAt(clips, offsets, 3).index, 1);
  close(engine.outputAt(clips, offsets, 6), 3);
  assert.equal(engine.outputAt(clips, offsets, 3), null);
});

test('repairs overlapping or invalid clips', () => {
  const clips = engine.normalizeClips([{ start: 3, end: 6, speed: 7 }, { start: 0, end: 4, speed: 2 }, { start: 5, end: 5.05 }], 10);
  assert.deepEqual(clips, [{ start: 0, end: 4, speed: 2 }, { start: 4, end: 6, speed: 1 }]);
  assert.deepEqual(engine.normalizeClips([], 10), [{ start: 0, end: 10, speed: 1 }]);
});

test('plans zooms that fit their activity and follow drags and typing', () => {
  const look = engine.normalizeLook({ zoomScale: 2.5 });
  const zooms = engine.planZooms(log, 12, look);
  assert.equal(zooms.length, 2);
  assert.ok(zooms[0].start < 2.1 && zooms[0].end > 3);
  // Two close clicks: zoomed in fully.
  close(zooms[0].scale, 2.5, 0.01);
  // A drag across a wider area plus typing: framed wider than the maximum.
  assert.ok(zooms[1].scale < 2.5);
  assert.ok(zooms[1].end >= 10.8);
  // Scrolling keeps the view wide.
  const scrolled = engine.planZooms({ ...log, scrolls: [{ t: 2.5, x: 0.2, y: 0.3, dx: 0, dy: 10 }] }, 12, look);
  assert.ok(scrolled[0].scale <= 1.4);
  assert.equal(engine.planZooms(null, 12, look).length, 0);
});

test('reads version 1 projects and plans zooms on first open', () => {
  const project = engine.normalizeProject({ version: 1, settings: { trimStart: 1, trimEnd: 11, background: 'ocean', disabledZooms: ['z2100'] } }, 12, log);
  assert.equal(project.look.background, 'ocean');
  assert.deepEqual(project.clips, [{ start: 1, end: 11, speed: 1 }]);
  assert.ok(project.zooms.every((zoom) => zoom.id !== 'z2100'));
  const fresh = engine.normalizeProject(null, 12, log);
  assert.equal(fresh.zooms.length, 2);
  const saved = engine.normalizeProject({ version: 2, look: {}, clips: [], zooms: [] }, 12, log);
  assert.equal(saved.zooms.length, 0);
});

test('camera zooms in, stays inside the frame, and is repeatable', () => {
  const look = engine.normalizeLook({});
  const clips = engine.normalizeClips([], 12);
  const zooms = engine.planZooms(log, 12, look);
  const track = engine.buildCameraTrack(log, zooms, clips, look);
  assert.deepEqual(track, engine.buildCameraTrack(log, zooms, clips, look));
  close(engine.cameraAt(track, 0).scale, 1);
  assert.ok(engine.cameraAt(track, 2.8).scale > 1.6);
  for (let time = 0; time <= 12; time += 0.05) {
    const camera = engine.cameraAt(track, time);
    const half = 0.5 / camera.scale;
    assert.ok(camera.x >= half - 1e-6 && camera.x <= 1 - half + 1e-6);
    assert.ok(camera.y >= half - 1e-6 && camera.y <= 1 - half + 1e-6);
  }
  const off = engine.buildCameraTrack(log, zooms, clips, { ...look, autoZoom: false });
  close(engine.cameraAt(off, 2.8).scale, 1);
  // A fixed zoom holds its focus instead of following the pointer.
  const fixed = [{ id: 'm', start: 0, end: 12, scale: 2, x: 0.3, y: 0.3, follow: false, focusAt: 0 }];
  const held = engine.cameraAt(engine.buildCameraTrack(log, fixed, clips, look), 8);
  close(held.x, 0.3, 0.01);
});

test('pointer is smoothed, lands on clicks, and fades when still', () => {
  const pointerLog = engine.normalizeInteractions({
    moves: [[0, 0.1, 0.1], [500, 0.9, 0.9], [520, 0.9, 0.9], [2000, 0.2, 0.8]],
    clicks: [[520, 0.9, 0.9, 0]],
    keys: []
  });
  const look = engine.normalizeLook({ cursorSmoothing: 1 });
  const clips = engine.normalizeClips([], 6);
  const track = engine.buildCursorTrack(pointerLog, clips, look);
  assert.ok(engine.cursorTrackAt(track, 0.3).x < engine.cursorAt(pointerLog.moves, 0.3).x);
  const atClick = engine.cursorTrackAt(track, 0.52);
  close(atClick.x, 0.9, 0.02);
  close(atClick.y, 0.9, 0.02);
  assert.equal(engine.cursorTrackAt(track, 2.5).alpha, 1);
  assert.ok(engine.cursorTrackAt(track, 5).alpha < 0.01);
  const shown = engine.buildCursorTrack(pointerLog, clips, { ...look, hideIdleCursor: false });
  assert.equal(engine.cursorTrackAt(shown, 5).alpha, 1);
});

test('places clicks and shortcuts on the edited timeline', () => {
  const clips = engine.normalizeClips([{ start: 0, end: 2.5, speed: 1 }, { start: 8, end: 12, speed: 2 }], 12);
  const events = engine.outputEvents(log, clips);
  assert.deepEqual(events.clicks.map((click) => click.source), [2.1, 9, 9.5]);
  close(events.clicks[1].t, 2.5 + 0.5);
  assert.equal(events.shortcuts[0].keys, '⌘⇧S');
  assert.deepEqual(engine.shortcutKeys('⌘⇧S'), ['⌘', '⇧', 'S']);
  assert.deepEqual(engine.shortcutKeys('⌃⌥F12'), ['⌃', '⌥', 'F12']);
});

test('fits output sizes to the chosen shape and quality', () => {
  assert.deepEqual(engine.outputSize(1920, 1080, 'auto'), { width: 1920, height: 1080 });
  assert.deepEqual(engine.outputSize(1920, 1080, 'tall'), { width: 1080, height: 1920 });
  assert.deepEqual(engine.outputSize(1920, 1080, 'square'), { width: 1440, height: 1440 });
  assert.deepEqual(engine.outputSize(3840, 2160, 'auto', 1080), { width: 1920, height: 1080 });
  assert.deepEqual(engine.outputSize(1920, 1080, 'tall', 720), { width: 720, height: 1280 });
  // Fixed sizes scale up as well as down; the long side stays within 3840.
  assert.deepEqual(engine.outputSize(2560, 1440, 'auto', 2160), { width: 3840, height: 2160 });
  assert.deepEqual(engine.outputSize(1920, 1080, 'auto', 1440), { width: 2560, height: 1440 });
  assert.deepEqual(engine.outputSize(2560, 1440, 'tall', 2160), { width: 2160, height: 3840 });
  assert.deepEqual(engine.outputSize(2560, 1440, 'auto'), { width: 2560, height: 1440 });
  const portrait = engine.outputSize(1920, 1080, 'portrait');
  close(portrait.width / portrait.height, 0.8, 0.01);
  // The original shape keeps the whole recording inside the frame.
  const box = engine.contentBox({ width: 1000, height: 1000 }, 1600, 900, engine.normalizeLook({ background: 'none' }));
  assert.equal(box.width, 1000);
  close(box.height, 562.5);
});

test('other shapes fill the frame with a matching crop that follows the action', () => {
  const look = engine.normalizeLook({ aspect: 'tall', background: 'none' });
  const box = engine.contentBox({ width: 1080, height: 1920 }, 1920, 1080, look);
  assert.deepEqual([box.width, box.height], [1080, 1920]);
  const shape = engine.frameShape(1920, 1080, look);
  close(shape.fx, (9 / 16) / (16 / 9), 1e-3);
  assert.equal(shape.fy, 1);
  assert.deepEqual(engine.frameShape(1920, 1080, engine.normalizeLook({})), { fx: 1, fy: 1 });

  const clips = engine.normalizeClips([], 12);
  const track = engine.buildCameraTrack(log, [], clips, { ...look, autoZoom: false }, shape);
  // Unzoomed, the view pans to keep the pointer in sight and stays inside the recording.
  const early = engine.cameraAt(track, 2.4);
  const late = engine.cameraAt(track, 8);
  assert.ok(early.x < 0.4 && late.x > 0.6);
  for (let time = 0; time <= 12; time += 0.05) {
    const camera = engine.cameraAt(track, time);
    const half = shape.fx / (2 * camera.scale);
    assert.ok(camera.x >= half - 1e-6 && camera.x <= 1 - half + 1e-6);
  }
  // A narrow view needs less zoom to fit the same activity.
  const wide = engine.planZooms(log, 12, engine.normalizeLook({ zoomScale: 3.5 }));
  const narrow = engine.planZooms(log, 12, engine.normalizeLook({ zoomScale: 3.5 }), shape);
  assert.ok(narrow[1].scale < wide[1].scale);
});

test('places the camera in its corner and keeps its size while zoomed', () => {
  const look = engine.normalizeLook({ cameraPosition: 'top-left', cameraSize: 0.2, cameraShape: 'circle' });
  const box = engine.cameraBox(look, 1000, 800, 1);
  assert.ok(box.x < 100 && box.y < 100);
  close(box.size, 160);
  close(box.radius, 80);
  close(engine.cameraBox(look, 1000, 800, 2).size, box.size);
  close(engine.cameraBox({ ...look, cameraShrink: false }, 1000, 800, 2).size, 160);
  const right = engine.cameraBox({ ...look, cameraPosition: 'bottom-right' }, 1000, 800, 1);
  assert.ok(right.x + right.size < 1000 && right.y + right.size < 800 && right.x > 500);
  assert.equal(engine.normalizeLook({ cameraShape: 'star' }).cameraShape, 'circle');
});


test('mixes click and typing sounds at their moments, the same every time', () => {
  const look = engine.normalizeLook({ clickSound: 'crisp', typingSound: 'mechanical', clickVolume: 1, typingVolume: 1 });
  const events = { clicks: [{ t: 0.5 }], keys: [{ t: 1 }, { t: 1.2 }], shortcuts: [] };
  const energy = (channel, from, to) => channel.slice(Math.round(from * 48000), Math.round(to * 48000)).reduce((sum, value) => sum + value * value, 0);
  const once = sounds.mixSoundEffects(null, 48000, 2, events, look);
  const again = sounds.mixSoundEffects(null, 48000, 2, events, look);
  assert.deepEqual(once, again);
  assert.equal(once[0].length, 96000);
  assert.ok(energy(once[0], 0.5, 0.55) > 1);
  assert.ok(energy(once[0], 1, 1.1) > 1);
  assert.equal(energy(once[0], 0, 0.45), 0);
  assert.ok(once[0].every((value) => Math.abs(value) <= 1));
  // Sounds switched off leave the soundtrack as it was.
  const quiet = engine.normalizeLook({ clickSound: 'none', typingSound: 'none' });
  assert.equal(sounds.mixSoundEffects(null, 48000, 2, events, quiet), null);
  for (const style of engine.CLICK_SOUNDS.slice(1)) assert.ok(sounds.clickSound(style, 48000).length > 0);
  for (const style of engine.TYPING_SOUNDS.slice(1)) assert.ok(sounds.typingSound(style, 48000, 0).length > 0);
});

test('reads key styles, the facecam spot, and picks readable key text', () => {
  const look = engine.normalizeLook({ keyColor: '#FFAA00', keySize: 'huge', keyPosition: 'top' });
  assert.equal(look.keyColor, '#ffaa00');
  assert.equal(look.keySize, 'medium');
  assert.equal(look.keyPosition, 'top');
  assert.equal(engine.normalizeLook({ keyColor: 'red' }).keyColor, '#18181b');
  assert.ok(engine.relativeLuminance('#ffffff') > 0.9 && engine.relativeLuminance('#18181b') < 0.05);
  const hinted = engine.normalizeInteractions({ moves: [[0, 0.5, 0.5]], cameraHint: { position: 'top-left', size: 0.9 } });
  assert.deepEqual(hinted.cameraHint, { position: 'top-left', size: 0.9, x: null, y: null });
  assert.equal(engine.normalizeInteractions({ moves: [[0, 0.5, 0.5]], cameraHint: { position: 'middle', size: 0.2 } }).cameraHint, null);
  const events = engine.outputEvents(log, engine.normalizeClips([], 12));
  assert.equal(events.keys.length, log.keys.length + log.shortcuts.length);
});


test('survives unusable lengths and sizes', () => {
  const clips = engine.normalizeClips([], Infinity);
  assert.deepEqual(clips, [{ start: 0, end: 0, speed: 1 }]);
  const look = engine.normalizeLook({});
  assert.equal(engine.buildCameraTrack(log, [], clips, look).length, 6);
  assert.equal(engine.planZooms(log, Infinity, look).length, 0);
  assert.deepEqual(engine.frameShape(0, 0, engine.normalizeLook({ aspect: 'square' })), { fx: 1, fy: 1 });
  assert.deepEqual(engine.outputSize(0, 1080, 'auto'), { width: 2, height: 2 });
  assert.equal(engine.normalizeInteractions({ moves: [[0, 0.5, 0.5]] }).rect, null);
});

test('keeps planned zooms inside the video and pairs drags with their own release', () => {
  const look = engine.normalizeLook({});
  const late = engine.normalizeInteractions({ moves: [[0, 0.5, 0.5]], clicks: [[1000, 0.4, 0.4, 0], [9000, 0.4, 0.4, 0]], keys: [] });
  const zooms = engine.planZooms(late, 5, look);
  assert.equal(zooms.length, 1);
  for (const zoom of zooms) assert.ok(zoom.focusAt >= zoom.start && zoom.focusAt <= zoom.end && zoom.end <= 5);
  // A click whose release was lost does not borrow a much later release.
  const lost = engine.normalizeInteractions({
    moves: [[0, 0.5, 0.5]],
    clicks: [[1000, 0.1, 0.1, 0], [8000, 0.9, 0.9, 0]],
    releases: [[8050, 0.2, 0.2, 0]],
    keys: []
  });
  const planned = engine.planZooms(lost, 12, look);
  assert.ok(planned[0].end < 4);
});

test('stretches very short clips instead of going silent', () => {
  const tone = new Float32Array(600).map((_, i) => Math.sin(i / 5));
  const [fast] = audio.timeStretch([tone], 48000, 2);
  assert.equal(fast.length, 300);
  assert.ok(fast.some((value) => Math.abs(value) > 0.5));
  const [slow] = audio.timeStretch([tone], 48000, 0.5);
  assert.equal(slow.length, 1200);
});

test('splits long stretches of activity into several zooms', () => {
  const clicks = Array.from({ length: 40 }, (_, i) => [i * 1000 + 500, 0.3 + (i % 3) * 0.05, 0.4, 0]);
  const busy = engine.normalizeInteractions({ moves: [[0, 0.5, 0.5]], clicks, keys: [] });
  const zooms = engine.planZooms(busy, 45, engine.normalizeLook({}));
  assert.ok(zooms.length >= 3);
  for (const zoom of zooms) assert.ok(zoom.end - zoom.start <= 12 + 0.9 + 1.6 + 1e-6);
  for (let i = 1; i < zooms.length; i += 1) assert.ok(zooms[i].start >= zooms[i - 1].end - 1e-6);
  assert.equal(new Set(zooms.map((zoom) => zoom.id)).size, zooms.length);
});


test('preserves facecam moves, resizing and positions beyond the content boundary', () => {
  const interactions = engine.normalizeInteractions({
    moves: [[0, 0.5, 0.5]],
    cameraHint: { position: 'bottom-right', size: 0.2, x: 0.8, y: 0.7 },
    cameraLayouts: [[0, 0.25, 0.3, 0.2], [2000, 1.05, -0.1, 0.3]]
  });
  const look = engine.normalizeLook({ cameraSize: 0.2 });
  const content = { x: 70, y: 50, width: 900, height: 600 };
  const first = engine.recordedCameraLayout(interactions, 1, look);
  const box = engine.cameraBox(look, 1040, 700, 1, content, first);
  close(box.x, 295); close(box.y, 230); close(box.size, 120);
  assert.deepEqual(engine.cameraBox(look, 1040, 700, 3, content, first), box);
  const moved = engine.recordedCameraLayout(interactions, 2.1, look);
  const outside = engine.cameraBox(look, 1040, 700, 1, content, moved);
  close(outside.x, 1015); close(outside.y, -10); close(outside.size, 180);
  assert.equal(engine.recordedCameraLayout(interactions, 3, { ...look, cameraRecorded: false }), null);
});
