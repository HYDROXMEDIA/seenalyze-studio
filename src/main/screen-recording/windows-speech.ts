import { app } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = 'v1.8.3';
const MODEL_HASH = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2';
const MODEL_NAME = 'ggml-large-v3-turbo-q5_0.bin';

// NVIDIA graphics run speech on the GPU like Apple silicon does; other PCs use
// the optimized math library build on the processor.
type Variant = 'cuda' | 'cpu';
const VARIANTS: Record<Variant, { archive: string; hash: string; libraries: string[] }> = {
  cuda: {
    archive: 'whisper-cublas-11.8.0-bin-x64.zip',
    hash: 'a5ef69599305bdf3e135047b1a2151dcea79bc0fa201e3ea8681069c2abc7a8c',
    libraries: ['ggml-cuda.dll', 'cudart64_110.dll']
  },
  cpu: {
    archive: 'whisper-blas-bin-x64.zip',
    hash: '2c9e6b95d9b679120553631d07b97d4bb1a56668a592052838dc9e7e24769c04',
    libraries: ['ggml-blas.dll', 'libopenblas.dll']
  }
};
const root = (variant: Variant) => join(app.getPath('userData'), 'tools', 'windows-speech', `${VERSION}-${variant}`);
const installedMarker = (variant: Variant) => join(root(variant), 'verified-runtime');
export const windowsModelPath = () => join(app.getPath('userData'), 'models', MODEL_NAME);

export class WindowsRuntimeUnavailable extends Error {
  constructor() { super('Local speech setup tools are required.'); }
}

async function runtimeInstalled(variant: Variant): Promise<string | null> {
  if ((await fs.readFile(installedMarker(variant), 'utf8').catch(() => '')) !== VARIANTS[variant].hash) return null;
  const server = await findServer(root(variant));
  if (server === null) return null;
  for (const file of ['ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'whisper.dll', ...VARIANTS[variant].libraries]) {
    if (!(await fs.stat(join(dirname(server), file)).catch(() => null))?.isFile()) return null;
  }
  return server;
}

export function checkWindowsSpeechRuntime(server: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(server, ['--help'], { windowsHide: true, timeout: 20000 }, (error) => {
      if (!error) { resolve(); return; }
      // STATUS_DLL_NOT_FOUND may be reported as signed or unsigned on Windows.
      if (Number(error.code) === 3221225781 || Number(error.code) === -1073741515) reject(new WindowsRuntimeUnavailable());
      else reject(new Error('Local speech runtime could not start. Retry setup.'));
    });
  });
}

async function findServer(directory: string): Promise<string | null> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === 'whisper-server.exe') return path;
    if (entry.isDirectory()) {
      const found = await findServer(path);
      if (found !== null) return found;
    }
  }
  return null;
}

function hasNvidiaGpu(): Promise<boolean> {
  return new Promise((resolve) => {
    // Installed with every current NVIDIA driver; it fails when there is no usable GPU.
    execFile('nvidia-smi.exe', ['-L'], { windowsHide: true, timeout: 10000 }, (error, stdout) => resolve(!error && /GPU \d+:/.test(String(stdout))));
  });
}

function variantOf(server: string): Variant {
  return server.startsWith(root('cuda')) ? 'cuda' : 'cpu';
}

export async function resolveWindowsSpeech(): Promise<string | null> {
  const server = await runtimeInstalled('cuda') ?? await runtimeInstalled('cpu');
  if (server === null) return null;
  const model = await fs.stat(windowsModelPath()).catch(() => null);
  if (model?.size !== 574041195) return null;
  return server;
}

// Stream large downloads to disk and verify them before making them usable.
async function downloadVerified(url: string, destination: string, expectedHash: string): Promise<void> {
  await fs.mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok || response.body === null) throw new Error('Speech download failed. Try setup again.');
    const hash = createHash('sha256');
    await pipeline(Readable.fromWeb(response.body as never), new Transform({
      transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); }
    }), createWriteStream(partial));
    if (hash.digest('hex') !== expectedHash) throw new Error('Speech download verification failed. Try setup again.');
    await fs.rename(partial, destination);
  } finally {
    await fs.rm(partial, { force: true }).catch(() => undefined);
  }
}

async function installRuntime(variant: Variant): Promise<string> {
  const directory = root(variant);
  const { archive: archiveName, hash } = VARIANTS[variant];
  if (await runtimeInstalled(variant) === null) {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
    const archive = join(directory, 'runtime.zip');
    await downloadVerified(`https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/${archiveName}`, archive, hash);
    try {
      await new Promise<void>((resolve, reject) => {
        // Paths are passed as process arguments, never interpolated into PowerShell code.
        execFile('tar.exe', ['-xf', archive, '-C', directory], { windowsHide: true, timeout: 60000 }, (error) => error ? reject(new Error('Speech runtime could not be unpacked. Try setup again.')) : resolve());
      });
      if (await findServer(directory) === null) throw new Error('Speech runtime is incomplete. Try setup again.');
      await fs.writeFile(installedMarker(variant), hash);
    } finally { await fs.rm(archive, { force: true }); }
  }
  const installedServer = await runtimeInstalled(variant);
  if (installedServer === null) throw new Error('Speech runtime is incomplete. Try setup again.');
  await checkWindowsSpeechRuntime(installedServer);
  return installedServer;
}

export async function installWindowsSpeech(): Promise<string> {
  if (process.arch !== 'x64') throw new Error('The Windows preview requires a 64-bit Intel or AMD PC.');
  // Runtimes from earlier versions of the app are replaced by the faster builds.
  await fs.rm(join(app.getPath('userData'), 'tools', 'windows-speech', VERSION), { recursive: true, force: true }).catch(() => undefined);
  let installed = false;
  if (await hasNvidiaGpu()) {
    installed = await installRuntime('cuda').then(() => true, async () => {
      // A GPU build that cannot start (for example an old driver) is removed in favor of the processor build.
      await fs.rm(root('cuda'), { recursive: true, force: true }).catch(() => undefined);
      return false;
    });
  }
  if (!installed) await installRuntime('cpu');
  if ((await fs.stat(windowsModelPath()).catch(() => null))?.size !== 574041195) {
    await downloadVerified(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`, windowsModelPath(), MODEL_HASH);
  }
  const server = await resolveWindowsSpeech();
  if (server === null) throw new Error('Local speech setup is incomplete. Try setup again.');
  return server;
}

// The server keeps no context between requests by default, so each dictation starts fresh.
export function windowsSpeechArgs(port: number, server: string): string[] {
  const threads = String(Math.max(4, Math.min(8, cpus().length - 2)));
  const gpu = variantOf(server) === 'cuda' ? ['--flash-attn'] : ['--no-gpu'];
  return ['--model', windowsModelPath(), '--host', '127.0.0.1', '--port', String(port), '--language', 'auto', '--threads', threads, ...gpu, '--no-timestamps'];
}
