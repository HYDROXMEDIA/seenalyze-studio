import { spawn, type ChildProcess } from 'node:child_process';

export type NativeCaptureOptions = {
  helperPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  // Recorded area in global points; input positions are reported relative to it.
  rect: { x: number; y: number; width: number; height: number };
  // Either a display (optionally cropped, in display points) or a window.
  displayId: number | null;
  crop: { x: number; y: number; width: number; height: number } | null;
  windowId: number | null;
  // 'default', a microphone name, or null for no sound.
  mic: string | null;
  // Camera name ('default' for the system choice) and where its video goes.
  camera: { name: string; outputPath: string } | null;
  excludePid: number;
  systemAudio?: boolean;
  systemAudioPid?: number | null;
};

export type CursorImage = { png: string; w: number; h: number; hx: number; hy: number };

export type NativeInput =
  | { kind: 'move'; t: number; x: number; y: number }
  | { kind: 'button'; down: boolean; t: number; x: number; y: number; button: number }
  | { kind: 'scroll'; t: number; x: number; y: number; dx: number; dy: number }
  | { kind: 'typing'; t: number }
  | { kind: 'shortcut'; t: number; keys: string };

export type NativeCaptureHandlers = {
  onStarted: () => void;
  onInput: (input: NativeInput) => void;
  // Whether clicks and keys can be seen (needs input access); moves always can.
  onInputAccess: (clicks: boolean) => void;
  onCameraReady: (ok: boolean) => void;
  onCursor: (time: number, id: number, image: CursorImage | null) => void;
  // Called once: with null when the file is complete, otherwise the reason it is not.
  onEnded: (error: string | null) => void;
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const MAX_LINE_LENGTH = 8 * 1024 * 1024;

// Runs the native screen recorder, which leaves the pointer out of the video.
export class NativeCapture {
  private child: ChildProcess | null = null;
  private buffer = '';
  private ended = false;
  private lastError: string | null = null;
  private finished = false;

  constructor(private readonly handlers: NativeCaptureHandlers) {}

  start(options: NativeCaptureOptions): void {
    const args = [
      '--output', options.outputPath,
      '--fps', String(options.fps),
      '--width', String(options.width),
      '--height', String(options.height),
      // Rounded the same way as the crop, so both describe the same area.
      '--rect', [options.rect.x, options.rect.y, options.rect.width, options.rect.height].map((value) => String(Math.round(value))).join(','),
      '--exclude-pid', String(options.excludePid)
    ];
    if (options.windowId !== null) {
      args.push('--window', String(options.windowId));
    } else if (options.displayId !== null) {
      args.push('--display', String(options.displayId));
      if (options.crop !== null) {
        const { x, y, width, height } = options.crop;
        args.push('--crop', [x, y, width, height].map((value) => String(Math.round(value))).join(','));
      }
    }
    if (options.systemAudio) args.push('--system-audio', '1');
    if (options.systemAudioPid) args.push('--system-audio-pid', String(options.systemAudioPid));
    if (options.mic !== null) args.push('--mic', options.mic);
    if (options.camera !== null) args.push('--camera', options.camera.name, '--camera-output', options.camera.outputPath);

    const child = spawn(options.helperPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.read(chunk));
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => this.end(error.message));
    // 'close' comes after all output was read, so a last "finished" is never missed.
    child.on('close', () => this.end(this.finished ? null : this.lastError ?? 'The recorder stopped unexpectedly'));
  }

  send(command: 'pause' | 'resume' | 'stop'): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${command}\n`);
  }

  kill(): void {
    this.child?.kill();
  }

  private end(error: string | null): void {
    if (this.ended) return;
    this.ended = true;
    this.child = null;
    this.handlers.onEnded(error);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    // A line never grows without end; the helper's longest lines are pointer images.
    if (this.buffer.length > MAX_LINE_LENGTH && !this.buffer.includes('\n')) this.buffer = '';
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.handle(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handle(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const { t, x, y } = message;
    if (message.type === 'm' && isNumber(t) && isNumber(x) && isNumber(y)) {
      this.handlers.onInput({ kind: 'move', t, x, y });
    } else if ((message.type === 'down' || message.type === 'up') && isNumber(t) && isNumber(x) && isNumber(y) && isNumber(message.b)) {
      this.handlers.onInput({ kind: 'button', down: message.type === 'down', t, x, y, button: message.b });
    } else if (message.type === 'scroll' && isNumber(t) && isNumber(x) && isNumber(y) && isNumber(message.dx) && isNumber(message.dy)) {
      this.handlers.onInput({ kind: 'scroll', t, x, y, dx: message.dx, dy: message.dy });
    } else if (message.type === 'typing' && isNumber(t)) {
      this.handlers.onInput({ kind: 'typing', t });
    } else if (message.type === 'shortcut' && isNumber(t) && typeof message.keys === 'string') {
      this.handlers.onInput({ kind: 'shortcut', t, keys: message.keys });
    } else if (message.type === 'camera') {
      this.handlers.onCameraReady(message.ok === true);
    } else if (message.type === 'input') {
      this.handlers.onInputAccess(message.clicks === true);
    } else if (message.type === 'started') {
      this.handlers.onStarted();
    } else if (message.type === 'recorded') { this.finished = true; return; }
    if (message.type === 'finished') {
      this.finished = true;
    } else if (message.type === 'error') {
      this.lastError = typeof message.message === 'string' ? message.message : 'Recording error';
    } else if (message.type === 'cursor' && isNumber(message.t) && isNumber(message.id)) {
      const { png, w, h, hx, hy } = message;
      const image = typeof png === 'string' && isNumber(w) && isNumber(h) && isNumber(hx) && isNumber(hy)
        ? { png, w, h, hx, hy }
        : null;
      this.handlers.onCursor(message.t, message.id, image);
    }
  }
}
