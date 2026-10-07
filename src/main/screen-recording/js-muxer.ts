import { closeSync, openSync, writeSync } from 'node:fs';
import { Muxer, StreamTarget } from 'mp4-muxer';

export type ExportAudioCodec = 'aac' | 'opus';

type Options = {
  output: string;
  width: number;
  height: number;
  fps: number;
  audio: { sampleRate: number; channels: number; codec: ExportAudioCodec } | null;
};

// Writes the editor's export MP4 inside the app, for systems without the macOS
// export helper. Video arrives already encoded (H.264, length-prefixed NAL
// units) and audio arrives encoded by the window, so this only packages them.
export class JsMuxer {
  private readonly fd: number;
  private readonly muxer: Muxer<StreamTarget>;
  private videoConfig: Uint8Array | null = null;
  private audioConfig: Uint8Array | null = null;
  private videoStarted = false;
  private audioStarted = false;
  private closed = false;
  private resolveFinished: (ok: boolean) => void = () => undefined;
  readonly finished = new Promise<boolean>((resolve) => {
    this.resolveFinished = resolve;
  });
  error = '';

  constructor(private readonly options: Options) {
    this.fd = openSync(options.output, 'w');
    this.muxer = new Muxer({
      target: new StreamTarget({
        // Writes land where the muxer asks, so the header can be patched at the end.
        onData: (data, position) => {
          writeSync(this.fd, data, 0, data.byteLength, position);
        }
      }),
      video: { codec: 'avc', width: options.width, height: options.height, frameRate: options.fps },
      ...(options.audio === null ? {} : { audio: { codec: options.audio.codec, sampleRate: options.audio.sampleRate, numberOfChannels: options.audio.channels } }),
      fastStart: false,
      firstTimestampBehavior: 'offset'
    });
  }

  get acceptsAudio(): boolean {
    return this.options.audio !== null;
  }

  setVideoConfig(description: Uint8Array): boolean {
    if (this.videoStarted) return false;
    this.videoConfig = description;
    return true;
  }

  setAudioConfig(description: Uint8Array | null): boolean {
    if (this.audioStarted || this.options.audio === null) return false;
    this.audioConfig = description;
    return true;
  }

  addVideo(data: Uint8Array, key: boolean, timestamp: number, duration: number): boolean {
    return this.guard(() => {
      if (this.videoConfig === null) throw new Error('Missing video configuration');
      const meta = this.videoStarted ? undefined : {
        decoderConfig: { codec: avcCodecString(this.videoConfig), codedWidth: this.options.width, codedHeight: this.options.height, description: this.videoConfig }
      };
      this.videoStarted = true;
      this.muxer.addVideoChunkRaw(data, key ? 'key' : 'delta', timestamp, duration, meta as Parameters<Muxer<StreamTarget>['addVideoChunkRaw']>[4]);
    });
  }

  addAudio(data: Uint8Array, timestamp: number, duration: number): boolean {
    return this.guard(() => {
      const audio = this.options.audio;
      if (audio === null) throw new Error('This export has no audio track');
      const meta = this.audioStarted ? undefined : {
        decoderConfig: {
          codec: audio.codec === 'aac' ? 'mp4a.40.2' : 'opus',
          sampleRate: audio.sampleRate,
          numberOfChannels: audio.channels,
          ...(this.audioConfig === null ? {} : { description: this.audioConfig })
        }
      };
      this.audioStarted = true;
      this.muxer.addAudioChunkRaw(data, 'key', timestamp, duration, meta as Parameters<Muxer<StreamTarget>['addAudioChunkRaw']>[4]);
    });
  }

  finish(): void {
    if (this.closed) return;
    const ok = this.guard(() => this.muxer.finalize());
    this.close(ok);
  }

  kill(): void {
    if (this.closed) return;
    this.error = this.error || 'canceled';
    this.close(false);
  }

  private guard(action: () => void): boolean {
    if (this.closed) return false;
    try {
      action();
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.close(false);
      return false;
    }
  }

  private close(ok: boolean): void {
    if (this.closed) return;
    this.closed = true;
    try {
      closeSync(this.fd);
    } catch {
      // Already closed; the result below still reports the outcome.
    }
    this.resolveFinished(ok);
  }
}

// "avc1.PPCCLL" from the profile, compatibility and level bytes of an avcC record.
function avcCodecString(avcC: Uint8Array): string {
  if (avcC.byteLength < 4) return 'avc1.640028';
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return `avc1.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}
