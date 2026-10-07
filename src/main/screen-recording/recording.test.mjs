import { writeFileSync } from 'node:fs';
import { afterAll as after, test } from 'bun:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'studio-recording-shutdown-'));
const state = globalThis.__recordingShutdownTest = {
  windows: [], captures: [], interactions: [], handlers: new Map(), listeners: new Map(),
  autoStart: true, sources: async () => [{ id: 'screen:1', display_id: '1' }]
};
class Window extends EventEmitter {
  destroyed = false;
  commands = [];
  webContents = { send: (command) => {
    this.commands.push(command);
    if (command === 'recorder:request-stop') this.onStop?.();
  } };
  constructor() { super(); state.windows.push(this); }
  isDestroyed() { return this.destroyed; }
  async loadFile() {}
  destroy() { this.destroyed = true; this.emit('closed'); }
}
class Interactions {
  begins = 0;
  stops = 0;
  saves = 0;
  constructor() { state.interactions.push(this); }
  begin() { this.begins++; }
  stop() { this.stops++; }
  async save() { this.saves++; this.stop(); }
  setCameraHint() {}
  setCursorHidden() {}
  setPaused() {}
}
class Capture {
  commands = [];
  kills = 0;
  constructor(handlers) { this.handlers = handlers; state.captures.push(this); }
  start(options) { if (state.autoStart) writeFileSync(options.outputPath, Buffer.from('fixture video')); if (state.autoStart) this.handlers.onStarted(); }
  send(command) { this.commands.push(command); if (command === 'stop') this.onStop?.(); }
  kill() { this.kills++; }
}
Object.assign(state, { Window, Interactions, Capture, directory: temporary });
const bundled = await build({
  entryPoints: [join(import.meta.dir, 'recording.ts')], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'recorder-stubs', setup(context) {
    context.onLoad({ filter: /screen-recording\/recording\.ts$/ }, async ({ path }) => ({
      contents: (await readFile(path, 'utf8')).replace('const SHUTDOWN_TIMEOUT_MS = 8000;', 'const SHUTDOWN_TIMEOUT_MS = 50;'),
      loader: 'ts'
    }));
    context.onResolve({ filter: /^(electron|\.\/interactions|\.\/native-recording|\.\/pages)$/ }, ({ path }) => ({ path, namespace: 'stub' }));
    context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'electron'
      ? `const state=globalThis.__recordingShutdownTest;
         export const systemPreferences={getMediaAccessStatus:()=> 'granted',askForMediaAccess:async()=>true}; export const app={getPath:()=>state.directory}; export const BrowserWindow=state.Window;
         export const desktopCapturer={getSources:()=>state.sources()};
         export const screen={getDisplayNearestPoint:()=>({id:1,scaleFactor:1,bounds:{x:0,y:0,width:1920,height:1080}})};
         export const ipcMain={handle:(name,handler)=>state.handlers.set(name,handler),on:(name,handler)=>state.listeners.set(name,handler)};`
      : path === './interactions' ? 'export const InteractionRecorder=globalThis.__recordingShutdownTest.Interactions;'
      : path === './pages' ? "export const preloadPath=()=>''; export const loadPage=async()=>undefined;"
      : 'export const NativeCapture=globalThis.__recordingShutdownTest.Capture;' }));
  } }]
});
const { RecordingController } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const request = { mode: 'screen', rect: { x: 0, y: 0, width: 1920, height: 1080 }, windowId: null, format: 'webm', resolution: '1080', fps: 30, micId: null, micLabel: null };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function controller({ native = false, onSaved = async () => {} } = {}) {
  const changes = [];
  const saved = [];
  const recorder = new RecordingController({
    log() {},
    outputDirectory: () => temporary, nativeRecorderPath: () => native ? '/test/recorder' : null,
    onStateChange: (recording) => changes.push(recording), onPauseChange() {},
    facecam: { hint: () => null, open() {}, close: () => null },
    onSaved: async (path) => { saved.push(path); await onSaved(); }
  });
  recorder.registerIpc();
  return { recorder, changes, saved };
}
const emit = (window, name, ...args) => state.listeners.get(name)({ sender: window.webContents }, ...args);
const invoke = (window, name, ...args) => state.handlers.get(name)({ sender: window.webContents }, ...args);
after(async () => {
  delete globalThis.__recordingShutdownTest;
  await rm(temporary, { recursive: true, force: true });
});

test('browser shutdown preserves the final chunk and waits for save and cleanup', async () => {
  const save = deferred();
  const { recorder, changes, saved } = controller({ onSaved: () => save.promise });
  assert.equal(await recorder.start(request), true);
  const window = state.windows.at(-1);
  assert.equal(await invoke(window, 'recorder:begin', 'webm'), true);
  emit(window, 'recorder:started');
  window.onStop = () => {
    emit(window, 'recorder:chunk', new Uint8Array([1, 2, 3]));
    emit(window, 'recorder:done');
  };
  let finished = false;
  const shutdown = recorder.shutdown().then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(finished, false);
  assert.deepEqual(changes, [true]);
  save.resolve();
  await shutdown;
  assert.deepEqual(await readFile(saved[0]), Buffer.from([1, 2, 3]));
  assert.deepEqual(changes, [true, false]);
  assert.equal(window.destroyed, true);
  assert.equal(recorder.isRecording(), false);
  assert.ok(state.interactions.at(-1).stops > 0);
  assert.equal(await recorder.start(request), false);
});

test('a missing browser stop response is bounded and closes its resources once', async () => {
  const { recorder, changes } = controller();
  await recorder.start(request);
  const window = state.windows.at(-1);
  await invoke(window, 'recorder:begin', 'webm');
  emit(window, 'recorder:started');
  const shutdown = recorder.shutdown();
  assert.equal(recorder.shutdown(), shutdown);
  await shutdown;
  assert.equal(window.destroyed, true);
  assert.equal(recorder.isRecording(), false);
  assert.deepEqual(changes, [true, false]);
  emit(window, 'recorder:done');
  assert.deepEqual(changes, [true, false]);
});

test('quit during source discovery cannot create a recording window', async () => {
  const discovery = deferred();
  state.sources = () => discovery.promise;
  const before = state.windows.length;
  const { recorder } = controller();
  const starting = recorder.start(request);
  const shutdown = recorder.shutdown();
  discovery.resolve([{ id: 'screen:1', display_id: '1' }]);
  assert.equal(await starting, false);
  await shutdown;
  assert.equal(state.windows.length, before);
  state.sources = async () => [{ id: 'screen:1', display_id: '1' }];
});

test('native shutdown waits for its final save before releasing recording state', async () => {
  const save = deferred();
  const { recorder, changes, saved } = controller({ native: true, onSaved: () => save.promise });
  assert.equal(await recorder.start({ ...request, format: 'mp4' }), true);
  const capture = state.captures.at(-1);
  capture.onStop = () => capture.handlers.onEnded(null);
  let finished = false;
  const shutdown = recorder.shutdown().then(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(finished, false);
  assert.equal(recorder.isRecording(), true);
  assert.deepEqual(capture.commands, ['stop']);
  save.resolve();
  await shutdown;
  assert.equal(saved.length, 1);
  assert.deepEqual(changes, [true, false]);
  assert.equal(capture.kills, 0);
  assert.equal(recorder.isRecording(), false);
});

test('a native helper that never starts is killed and startup settles on quit', async () => {
  state.autoStart = false;
  const { recorder, changes } = controller({ native: true });
  const starting = recorder.start({ ...request, format: 'mp4' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const capture = state.captures.at(-1);
  await recorder.shutdown();
  assert.equal(await starting, false);
  assert.equal(capture.kills, 1);
  assert.equal(recorder.isRecording(), false);
  assert.deepEqual(changes, []);
  capture.handlers.onStarted();
  capture.handlers.onEnded('stopped');
  assert.deepEqual(changes, []);
  state.autoStart = true;
});
