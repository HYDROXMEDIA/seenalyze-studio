import { afterAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, access, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = globalThis.__recordingFixesTest = { devices: [], handlers: new Map(), windows: [], response: 1, trashed: [], changed: 0 };
class Window extends EventEmitter {
  destroyed = false;
  webContents = {};
  constructor() { super(); state.windows.push(this); }
  isDestroyed() { return this.destroyed; }
  async loadFile() {}
  destroy() { this.destroyed = true; this.emit('closed'); }
}
state.Window = Window;
const directory = await mkdtemp(join(tmpdir(), 'studio-recording-fixes-'));
state.directory = directory;
const bundled = await build({
  stdin: { contents: "export { recordingMicrophone } from './audio-input'; export { EditorWindows } from './editor';", resolveDir: import.meta.dir, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'recording-fixes-stubs', setup(context) {
    context.onResolve({ filter: /^(electron|node:child_process|\.\/i18n|\.\/recording|\.\/pages|\.\/media-protocol)$/ }, ({ path }) => ({ path, namespace: 'stub' }));
    context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents:
      path === 'electron' ? `const s=globalThis.__recordingFixesTest;
        export const app={getPath:()=>s.directory}; export const BrowserWindow=s.Window;
        export const dialog={showMessageBox:async (_window,options)=>{s.dialog=options;return {response:s.response}}};
        export const ipcMain={handle:(name,handler)=>s.handlers.set(name,handler),on:()=>{}};
        export const nativeImage={}; export const screen={getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1440,height:900}})};
        export const shell={trashItem:async path=>{s.trashed.push(path);await (await import('node:fs/promises')).rm(path)}};`
      : path === 'node:child_process' ? `export function execFile(_command,_args,_options,callback){callback(null,JSON.stringify({SPAudioDataType:[{_items:globalThis.__recordingFixesTest.devices}]}))} export function spawn(){throw Error('Unexpected export')}`
      : path === './i18n' ? `export const t=key=>key;`
      : path === './pages' ? `export const preloadPath=()=>''; export const loadPage=async()=>undefined;`
      : path === './media-protocol' ? `export const mediaUrl=path=>'recording-media://file/'+encodeURIComponent(path); export const forgetMedia=()=>undefined;`
      : `export const cameraPath=path=>path.replace(/\\.[^./]+$/, '')+'.camera.mp4';` }));
  } }]
});
const { recordingMicrophone, EditorWindows } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('uses a local microphone for Bluetooth input without changing wired selections', async () => {
  if (process.platform !== 'darwin') return;
  state.devices = [
    { _name: 'Headset', coreaudio_default_audio_input_device: 'spaudio_yes', coreaudio_device_transport: 'coreaudio_device_type_bluetooth', coreaudio_device_input: 1 },
    { _name: 'Local mic', coreaudio_device_transport: 'coreaudio_device_type_builtin', coreaudio_device_input: 1 },
    { _name: 'USB mic', coreaudio_device_transport: 'coreaudio_device_type_usb', coreaudio_device_input: 1 }
  ];
  assert.equal(await recordingMicrophone('default'), 'Local mic');
  assert.equal(await recordingMicrophone('Headset'), 'Local mic');
  assert.equal(await recordingMicrophone('USB mic'), 'USB mic');
  state.devices = state.devices.slice(0, 1);
  assert.equal(await recordingMicrophone('default'), null);
  assert.equal(await recordingMicrophone(null), null);
});

test('discard cancellation preserves files; confirmation removes camera, source and edits', async () => {
  const video = join(directory, 'Screen Recording test.mp4');
  const camera = join(directory, 'Screen Recording test.camera.mp4');
  await writeFile(video, 'video'); await writeFile(camera, 'camera');
  const editor = new EditorWindows({ log() {}, theme: () => 'dark', openAfterRecording: () => true, setOpenAfterRecording() {}, onExported() { state.changed++; }, transcribe: async () => ({ captions: [] }), cancelTranscription() {}, muxerPath: () => null });
  editor.registerIpc();
  await editor.open(video);
  const window = state.windows.at(-1);
  const event = { sender: window.webContents };
  const save = state.handlers.get('editor:save-project');
  const discard = state.handlers.get('editor:discard');
  await save(event, JSON.stringify({ version: 2 }));
  assert.deepEqual(await discard(event), { ok: false, canceled: true });
  await access(video); await access(camera);
  assert.equal(window.destroyed, false);
  assert.equal(state.dialog.defaultId, state.dialog.cancelId);
  state.response = 0;
  const pendingSave = save(event, JSON.stringify({ version: 2, look: {} }));
  assert.deepEqual(await discard(event), { ok: true });
  await pendingSave;
  await assert.rejects(access(video)); await assert.rejects(access(camera));
  assert.equal(window.destroyed, true); assert.equal(state.changed, 1);
  assert.deepEqual(await readdir(join(directory, 'recording-data')), []);
  assert.deepEqual(await discard({ sender: {} }), { ok: false });
});

afterAll(async () => { delete globalThis.__recordingFixesTest; await rm(directory, { recursive: true, force: true }); });
