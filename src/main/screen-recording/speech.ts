// Local speech recognition for editor captions. macOS runs WhisperKit (built
// once from its source with the Apple developer tools); Windows runs a
// checksum-verified whisper.cpp server. Either way recognition happens on this
// computer: the recording's sound is split into short parts at pauses and each
// part is transcribed by a local server that listens on 127.0.0.1 only.
// The server starts when captions are requested and stops after a while
// unused, so a live stream never shares the machine with an idle model.

import { app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { abortable } from './abortable';
import { helperPath, scriptPath } from './pages';
import { checkWindowsSpeechRuntime, installWindowsSpeech, resolveWindowsSpeech, windowsSpeechArgs } from './windows-speech';

export type Caption = { start: number; end: number; text: string };

const WHISPERKIT_MODEL_NAME = 'large-v3_turbo';
const WHISPERKIT_VERSION = '0.18.0';
const WHISPERKIT_SOURCE_URL = `https://github.com/argmaxinc/WhisperKit/archive/refs/tags/v${WHISPERKIT_VERSION}.tar.gz`;
const IDLE_STOP_MS = 5 * 60 * 1000;
// Building the recognizer and downloading its model happen once and can be slow.
const SETUP_TIMEOUT_MS = 60 * 60 * 1000;
const READY_ATTEMPTS = 900;
const MAX_MEDIA_BYTES = 2 * 1024 ** 3;
const MAX_PARTS = 3600;
const MAX_SECONDS = 6 * 3600;
const IS_WINDOWS = process.platform === 'win32';

type Server = { child: ChildProcess; root: string; ready: Promise<void> };

function managedWhisperCliPath(): string {
  return join(app.getPath('userData'), 'tools', 'whisperkit-cli');
}

function modelRootPath(): string {
  return join(app.getPath('userData'), 'models');
}

async function isExecutable(filePath: string): Promise<boolean> {
  return fs.access(filePath, fsConstants.X_OK).then(() => true, () => false);
}

function which(command: string): Promise<string | null> {
  return new Promise((resolveWhich) => {
    execFile('/usr/bin/which', [command], (error, stdout) => resolveWhich(error ? null : stdout.trim() || null));
  });
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: (line: string) => void, label: string): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) log(`${label}: ${line.slice(0, 240)}`);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolveRun(output) : reject(new Error(`${label} exited with code ${code ?? -1}`))));
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address !== null ? resolvePort(address.port) : reject(new Error('No free port'))));
    });
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveStop();
    }, 3000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}

export class SpeechService {
  private server: Server | null = null;
  private starting: Promise<Server> | null = null;
  private installing: Promise<string> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly jobs = new Map<string, AbortController>();
  private shuttingDown = false;

  constructor(private readonly log: (line: string) => void) {}

  get busy(): boolean {
    return this.jobs.size > 0;
  }

  /** Splits a recording's sound into parts and turns each one into a caption. */
  async transcribeMedia(path: string, id: string, onProgress: (progress: number) => void): Promise<{ captions: Caption[] }> {
    if (this.jobs.size > 0) throw new Error('A transcription is already running.');
    const file = await fs.stat(path);
    if (!file.isFile() || file.size > MAX_MEDIA_BYTES) throw new Error('This media file is too large.');
    const controller = new AbortController();
    this.jobs.set(id, controller);
    let directory: string | null = null;
    try {
      // Preparing the recognizer the first time can take a while; the editor shows that state.
      onProgress(-1);
      await abortable(this.ensureServer(), controller.signal, SETUP_TIMEOUT_MS);
      controller.signal.throwIfAborted();
      directory = await fs.mkdtemp(join(app.getPath('temp'), 'studio-captions-'));
      const chunks = await this.prepareAudio(path, directory, controller.signal);
      const captions: Caption[] = [];
      onProgress(0);
      for (const [index, chunk] of chunks.entries()) {
        controller.signal.throwIfAborted();
        const text = await this.transcribeFile(chunk.path, controller.signal);
        if (text) captions.push({ start: chunk.start, end: chunk.end, text });
        onProgress((index + 1) / chunks.length);
      }
      return { captions };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Canceled', { cause: error });
      throw error;
    } finally {
      this.jobs.delete(id);
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      this.scheduleIdleStop();
    }
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const job of this.jobs.values()) job.abort();
    await this.stopServer();
  }

  private scheduleIdleStop(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.jobs.size === 0) void this.stopServer();
    }, IDLE_STOP_MS);
    this.idleTimer.unref();
  }

  private async stopServer(): Promise<void> {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const server = this.server;
    this.server = null;
    if (server !== null) {
      await stopChild(server.child);
      this.log('Caption recognizer stopped');
    }
  }

  // Decodes the recording's sound to 16 kHz mono and splits it at pauses.
  private prepareAudio(path: string, directory: string, signal: AbortSignal): Promise<Array<{ path: string; start: number; end: number }>> {
    const executable = IS_WINDOWS ? 'powershell.exe' : helperPath('media-tools');
    const args = IS_WINDOWS
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('windows_media_tools.ps1'), 'audio', path, directory]
      : ['audio', path, directory];
    return new Promise((resolvePrepare, reject) => {
      execFile(executable, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, signal, windowsHide: true }, (error, stdout) => {
        if (error) {
          reject(new Error('The recording could not be prepared for captions.'));
          return;
        }
        try {
          const reply = JSON.parse(stdout) as { chunks?: unknown; error?: unknown };
          if (typeof reply.error === 'string') throw new Error(reply.error);
          const chunks = reply.chunks as Array<{ path: string; start: number; end: number }>;
          const valid = Array.isArray(chunks) && chunks.length <= MAX_PARTS && chunks.every((chunk, index) => chunk !== null && typeof chunk === 'object'
            && typeof chunk.path === 'string' && dirname(resolve(chunk.path)) === resolve(directory)
            && Number.isFinite(chunk.start) && Number.isFinite(chunk.end) && chunk.start >= 0 && chunk.end > chunk.start && chunk.end <= MAX_SECONDS
            && (index === 0 || chunk.start >= chunks[index - 1].end - 0.01));
          if (!valid) throw new Error('The recording is too long for captions.');
          resolvePrepare(chunks);
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
        }
      });
    });
  }

  private async transcribeFile(audioPath: string, signal: AbortSignal): Promise<string> {
    const server = await this.ensureServer();
    const body = new FormData();
    body.append('model', WHISPERKIT_MODEL_NAME);
    body.append('response_format', 'json');
    if (IS_WINDOWS) body.append('language', 'auto');
    body.append('file', new Blob([await fs.readFile(audioPath)], { type: 'audio/wav' }), 'part.wav');
    const response = await abortable(fetch(`${server.root}${IS_WINDOWS ? '/inference' : '/v1/audio/transcriptions'}`, {
      method: 'POST',
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)])
    }), signal, 120000);
    if (!response.ok) throw new Error(`Transcription failed with status ${response.status}`);
    const payload = (await response.json()) as { text?: unknown };
    return typeof payload.text === 'string' ? payload.text.trim() : '';
  }

  private ensureServer(): Promise<Server> {
    if (this.server !== null && this.server.child.exitCode === null) return this.server.ready.then(() => this.server as Server);
    if (this.starting !== null) return this.starting;
    const starting = this.startServer().finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  private async startServer(): Promise<Server> {
    if (this.shuttingDown) throw new Error('Canceled');
    const executable = await this.resolveRuntime();
    if (IS_WINDOWS) await checkWindowsSpeechRuntime(executable);
    const port = await freePort();
    const args = IS_WINDOWS
      ? windowsSpeechArgs(port, executable)
      : ['serve', '--model', WHISPERKIT_MODEL_NAME, '--download-model-path', modelRootPath(), '--audio-encoder-compute-units', 'cpuAndGPU',
        '--text-decoder-compute-units', 'cpuAndGPU', '--use-prefill-cache', '--use-prefill-prompt', '--without-timestamps', '--host', '127.0.0.1', '--port', String(port)];
    const child = spawn(executable, args, { windowsHide: true, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line && !IS_WINDOWS) this.log(`Caption recognizer: ${line.slice(0, 240)}`);
    });
    const root = `http://127.0.0.1:${port}`;
    const server: Server = { child, root, ready: this.waitReady(child, root) };
    this.server = server;
    child.once('exit', () => {
      if (this.server === server) this.server = null;
    });
    this.log('Caption recognizer starting');
    try {
      await server.ready;
    } catch (error) {
      if (this.server === server) this.server = null;
      await stopChild(child);
      throw error;
    }
    return server;
  }

  // The first start downloads the model, so readiness can take many minutes.
  private async waitReady(child: ChildProcess, root: string): Promise<void> {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null || this.shuttingDown) throw new Error('The caption recognizer stopped.');
      try {
        const response = await fetch(`${root}/${IS_WINDOWS ? 'health' : ''}`, { signal: AbortSignal.timeout(2000) });
        if (IS_WINDOWS && (!response.ok || (await response.json() as { status?: string }).status !== 'ok')) throw new Error('loading');
        this.log('Caption recognizer ready');
        return;
      } catch {
        await delay(1000);
      }
    }
    throw new Error('The caption recognizer did not start.');
  }

  private resolveRuntime(): Promise<string> {
    if (this.installing !== null) return this.installing;
    const installing = (async () => {
      if (IS_WINDOWS) return (await resolveWindowsSpeech()) ?? (await installWindowsSpeech());
      if (process.platform !== 'darwin') throw new Error('Captions are unavailable on this system.');
      const managed = managedWhisperCliPath();
      if (await isExecutable(managed)) return managed;
      const installed = await which('whisperkit-cli');
      if (installed !== null) return installed;
      await this.installWhisperKit();
      return managed;
    })().finally(() => {
      if (this.installing === installing) this.installing = null;
    });
    this.installing = installing;
    return installing;
  }

  // Builds whisperkit-cli from the pinned source release with the Apple developer tools.
  private async installWhisperKit(): Promise<void> {
    const swift = await which('swift');
    if (swift === null) throw new Error('Install the Apple Command Line Tools to generate captions.');
    const buildRoot = join(app.getPath('userData'), 'bootstrap', `whisperkit-${WHISPERKIT_VERSION}`);
    const archive = join(buildRoot, 'whisperkit.tar.gz');
    const sourceRoot = join(buildRoot, `WhisperKit-${WHISPERKIT_VERSION}`);
    await fs.rm(buildRoot, { recursive: true, force: true });
    await fs.mkdir(buildRoot, { recursive: true });
    this.log(`Downloading WhisperKit v${WHISPERKIT_VERSION} source`);
    const response = await fetch(WHISPERKIT_SOURCE_URL, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok) throw new Error(`WhisperKit download failed: ${response.status}`);
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const env = { ...process.env, BUILD_ALL: '1', NO_COLOR: '1' };
    await run('/usr/bin/tar', ['-xzf', archive], buildRoot, env, this.log, 'tar');
    this.log('Building WhisperKit');
    await run(swift, ['build', '-c', 'release', '--product', 'whisperkit-cli'], sourceRoot, env, this.log, 'swift build');
    const binPath = (await run(swift, ['build', '-c', 'release', '--show-bin-path'], sourceRoot, env, this.log, 'swift build')).trim();
    const built = join(binPath, 'whisperkit-cli');
    if (!(await isExecutable(built))) throw new Error('WhisperKit could not be built.');
    // Copy next to the final path, then rename, so an interrupted install never leaves half a binary.
    const target = managedWhisperCliPath();
    await fs.mkdir(dirname(target), { recursive: true });
    const partial = `${target}.partial-${process.pid}`;
    try {
      await fs.copyFile(built, partial);
      await fs.chmod(partial, 0o755);
      await fs.rename(partial, target);
    } finally {
      await fs.rm(partial, { force: true }).catch(() => undefined);
    }
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => undefined);
    this.log('WhisperKit installed');
  }
}
