// Exports the edited video frame by frame: every output frame is drawn with
// the same engine as the preview at its exact time, encoded with the Mac's
// hardware H.264 encoder, and written to an MP4 together with the edited
// soundtrack. Nothing depends on playback speed, so no frame is ever dropped.

import { clipOffsets, drawFrame, motionAt, outputDuration, sourceAt } from './engine.js';
import { assembleSoundtrack, interleave } from './audio.js';
import { openMp4, sampleData } from './mp4.js';
import { mixSoundEffects } from './sounds.js';

const EFFECTS_SAMPLE_RATE = 48000;

export const QUALITY_BITS = { standard: 0.07, high: 0.14, max: 0.28 };
const MAX_BITRATE = 150_000_000;
const KEYFRAME_SECONDS = 2;
const AUDIO_AHEAD_SECONDS = 0.5;
const BLUR_FRAME = 1 / 60;
const SEEK_TIMEOUT_MS = 10000;
const NO_FRAME = 'No frame for this time';
// Encoded frames waiting to be written before rendering pauses for them.
const MAX_PENDING_CHUNKS = 12;
const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.64002a', 'avc1.640028'];

export class ExportCanceled extends Error {}

// Decodes an MP4's frames in order and hands out the frame showing at a time.
// Times only move forward during an export, so frames are decoded once; a jump
// over a cut restarts decoding at the nearest key frame.
class Mp4Frames {
  constructor(read, track) {
    this.read = read;
    this.track = track;
    this.width = track.width;
    this.height = track.height;
    this.frames = [];
    this.next = 0;
    this.error = null;
    this.waiters = [];
    this.decoder = null;
  }

  async start() {
    const config = { codec: this.track.codec, description: this.track.description, codedWidth: this.track.width, codedHeight: this.track.height, hardwareAcceleration: 'prefer-hardware' };
    const support = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!support.supported) return false;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.frames.push(frame);
        this.frames.sort((a, b) => a.timestamp - b.timestamp);
        this.wake();
      },
      error: (error) => {
        this.error = error;
        this.wake();
      }
    });
    this.decoder.configure(config);
    return true;
  }

  wake() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  waitForOutput() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      // Decoders may hold frames back until more input arrives; do not wait forever.
      setTimeout(resolve, 50);
    });
  }

  lastKeyAtOrBefore(time) {
    const samples = this.track.samples;
    let found = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].decodeTime > time + 1) break;
      if (samples[i].key && samples[i].time <= time) found = i;
    }
    return found;
  }

  async restartAt(time) {
    if (this.decoder.state !== 'closed') this.decoder.close();
    this.frames.forEach((frame) => frame.close());
    this.frames = [];
    await this.start();
    this.next = this.lastKeyAtOrBefore(time);
  }

  async feed(count) {
    const samples = this.track.samples;
    const to = Math.min(samples.length, this.next + count);
    for await (const { sample, data } of sampleData(this.read, samples, this.next, to)) {
      this.decoder.decode(new EncodedVideoChunk({
        type: sample.key ? 'key' : 'delta',
        timestamp: Math.round(sample.time * 1e6),
        duration: Math.round(sample.duration * 1e6),
        data
      }));
    }
    this.next = to;
    if (this.next >= samples.length) await this.decoder.flush();
  }

  // The frame on screen at `time` (seconds): the last one that starts at or before it.
  async frameAt(time) {
    const target = Math.round(time * 1e6) + 500;
    const samples = this.track.samples;
    // A long jump forward (over a cut) restarts at a key frame instead of decoding everything between.
    const buffered = this.frames.length > 0 ? this.frames[this.frames.length - 1].timestamp : -Infinity;
    const nextSample = samples[this.next];
    if (nextSample !== undefined && time - Math.max(buffered / 1e6, nextSample.time) > KEYFRAME_SECONDS * 2) {
      const key = this.lastKeyAtOrBefore(time);
      if (key > this.next) await this.restartAt(time);
    }
    for (;;) {
      if (this.error !== null) throw this.error;
      // Only the newest frame at or before the target can still be shown.
      let shown = -1;
      for (let i = 0; i < this.frames.length && this.frames[i].timestamp <= target; i += 1) shown = i;
      if (shown > 0) this.frames.splice(0, shown).forEach((frame) => frame.close());
      const later = this.frames.findIndex((frame) => frame.timestamp > target);
      const ended = this.next >= samples.length && this.decoder.decodeQueueSize === 0;
      if (later !== -1 || (ended && this.frames.length > 0)) {
        const index = later === -1 ? this.frames.length - 1 : Math.max(0, later - 1);
        // Frames before the one shown are no longer needed.
        this.frames.splice(0, index).forEach((frame) => frame.close());
        return this.frames[0];
      }
      if (ended) throw new Error(NO_FRAME);
      if (this.next < samples.length && this.decoder.decodeQueueSize < 8 && this.frames.length < 12) {
        await this.feed(8);
      } else {
        await this.waitForOutput();
      }
    }
  }

  close() {
    this.frames.forEach((frame) => frame.close());
    this.frames = [];
    if (this.decoder !== null && this.decoder.state !== 'closed') this.decoder.close();
  }
}

// For recordings that cannot be read sample by sample: seek the video element
// to each needed moment and wait until that picture is shown.
class ElementFrames {
  constructor(video) {
    this.video = video;
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.frameTime = 1 / 60;
  }

  async frameAt(time) {
    const video = this.video;
    if (Math.abs(video.currentTime - time) >= this.frameTime / 2 || video.readyState < 2) {
      // Once the seek completes, the picture at that time can be drawn.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The video stopped responding')), SEEK_TIMEOUT_MS);
        const done = (error) => {
          clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          if (error) reject(error);
          else resolve();
        };
        const onSeeked = () => done(null);
        const onError = () => done(new Error('The video could not be read'));
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.currentTime = time;
      });
    }
    return video;
  }

  close() {}
}

// The whole recording's sound as planar samples, or null when it has none.
// The whole recording's sound as planar samples (at most two channels), or
// null when it has none. Each decoded piece is placed at its own time, so gaps
// and delayed tracks stay in sync with the picture, and encoder start-up
// samples (before time zero) are left out.
async function decodeMp4Audio(read, track) {
  const config = { codec: track.codec, sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.description };
  const support = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!support.supported) return null;
  const last = track.samples[track.samples.length - 1];
  if (last === undefined) return null;
  const seconds = last.time + last.duration;
  let output = null;
  let failure = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        // The decoder's own rate is the true one (it can differ from the file header).
        output ??= {
          sampleRate: data.sampleRate,
          channels: Array.from({ length: Math.min(2, data.numberOfChannels) }, () => new Float32Array(Math.ceil((seconds + 1) * data.sampleRate)))
        };
        const at = Math.round((data.timestamp / 1e6) * output.sampleRate);
        const plane = new Float32Array(data.numberOfFrames);
        for (let c = 0; c < output.channels.length; c += 1) {
          data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          const target = output.channels[c];
          const from = Math.max(0, -at);
          const count = Math.min(plane.length - from, target.length - Math.max(0, at));
          if (count > 0) target.set(plane.subarray(from, from + count), Math.max(0, at));
        }
      } catch (error) {
        failure ??= error;
      } finally {
        data.close();
      }
    },
    error: (error) => {
      failure ??= error;
    }
  });
  decoder.configure(config);
  try {
    for await (const { sample, data } of sampleData(read, track.samples, 0, track.samples.length)) {
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(sample.time * 1e6), duration: Math.round(sample.duration * 1e6), data }));
      if (decoder.decodeQueueSize > 64) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  if (failure !== null) throw failure;
  return output;
}

// Largest recording whose sound is read in one piece when it cannot be read in parts.
const MAX_WHOLE_AUDIO_BYTES = 1024 * 1024 * 1024;

async function decodeWholeAudio(url, fileSize) {
  if (fileSize > MAX_WHOLE_AUDIO_BYTES) throw new Error('The recording is too large to read its sound');
  const bytes = await (await fetch(url)).arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 48000);
  const buffer = await context.decodeAudioData(bytes).catch(() => null);
  if (buffer === null) return null;
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  return { sampleRate: buffer.sampleRate, channels };
}

const AUDIO_BITRATE = 192_000;

// AAC plays everywhere; Opus is the fallback where no AAC encoder is available.
async function pickAudioCodec(sampleRate, channels) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const codec of ['mp4a.40.2', 'opus']) {
    const config = { codec, sampleRate, numberOfChannels: channels, bitrate: AUDIO_BITRATE };
    const support = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (support.supported) return config;
  }
  return null;
}

async function pickEncoder(width, height, fps, bitrate) {
  for (const codec of CODECS) {
    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' }
    };
    const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (support.supported) return config;
  }
  return null;
}

// Runs one export. `job` describes the edit and the chosen size, rate and quality.
export async function runExport(job) {
  const { api, video, videoUrl, fileSize, cameraVideo, cameraFileSize, project, derived, assets, settings, onProgress, isCanceled } = job;
  const { clips } = project;
  const { width, height, fps } = settings;
  const offsets = clipOffsets(clips);
  const total = outputDuration(clips);
  const frameCount = Math.max(1, Math.round(total * fps));
  const bitrate = Math.min(MAX_BITRATE, Math.round(width * height * fps * QUALITY_BITS[settings.quality]));

  const encoderConfig = await pickEncoder(width, height, fps, bitrate);
  if (encoderConfig === null) throw new Error('unsupported');

  // Frames: read the MP4 directly when possible, else seek the player.
  const reader = (source) => async (offset, length) => {
    const bytes = await api.readRange(offset, length, source);
    if (bytes === null || bytes.length !== length) throw new Error('The recording could not be read');
    return bytes;
  };
  const read = reader('video');
  // Every write to the export file must succeed, or the export stops.
  const written = async (result) => {
    if (!(await result)) throw new Error('The export could not be written');
  };
  const file = fileSize > 0 ? await openMp4(read, fileSize).catch(() => null) : null;
  let frames = null;
  if (file !== null) {
    const decoded = new Mp4Frames(read, file.video);
    if (await decoded.start()) frames = decoded;
  }
  frames ??= new ElementFrames(video);

  // The camera track, when there is one and it is shown.
  let cameraFrames = null;
  if (cameraVideo !== null && project.look.showCamera) {
    const readCamera = reader('camera');
    const cameraFile = cameraFileSize > 0 ? await openMp4(readCamera, cameraFileSize).catch(() => null) : null;
    if (cameraFile !== null) {
      const decoded = new Mp4Frames(readCamera, cameraFile.video);
      if (await decoded.start()) cameraFrames = decoded;
    }
    cameraFrames ??= new ElementFrames(cameraVideo);
  }

  // Decoders are closed however the export ends.
  try {
    return await encodeAll();
  } finally {
    frames.close();
    cameraFrames?.close();
  }

  async function encodeAll() {
    const sound = file !== null
      ? file.audio === null ? null : await decodeMp4Audio(read, file.audio)
      : await decodeWholeAudio(videoUrl, fileSize);
    const edited = sound === null ? null : assembleSoundtrack(sound.channels, sound.sampleRate, clips);
    const sampleRate = sound?.sampleRate ?? EFFECTS_SAMPLE_RATE;
    // Click and typing sounds are mixed in; they also make a soundtrack when the recording has none.
    const soundtrack = mixSoundEffects(edited, sampleRate, total, derived.events, project.look);
    if (isCanceled()) throw new ExportCanceled();

    const audioConfig = soundtrack === null ? null : await pickAudioCodec(sampleRate, soundtrack.length);
    const begin = await api.exportBegin({
      width,
      height,
      fps,
      audio: soundtrack === null ? null : {
        sampleRate,
        channels: soundtrack.length,
        codec: audioConfig === null ? null : audioConfig.codec === 'opus' ? 'opus' : 'aac'
      }
    });
    if (!begin.ok) return begin.canceled ? { canceled: true } : { ok: false, protected: begin.protected === true };
    // The macOS helper takes raw samples; elsewhere the audio is encoded here.
    const audioMode = soundtrack === null ? 'none' : begin.audio ?? 'pcm';

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    let sending = Promise.resolve();
    let pendingChunks = 0;
    let configured = false;
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const description = metadata?.decoderConfig?.description;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const header = { timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key' };
        pendingChunks += 1;
        sending = sending.then(async () => {
          if (!configured) {
            if (description === undefined) throw new Error('Missing video configuration');
            const bytes = description instanceof ArrayBuffer
              ? new Uint8Array(description)
              : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
            await written(api.exportConfig(bytes.slice()));
            configured = true;
          }
          await written(api.exportVideo(header, data));
        }).finally(() => {
          pendingChunks -= 1;
        });
        // A failure is picked up by the next wait; none is left unhandled.
        sending.catch(() => undefined);
      },
      error: (error) => {
        encodeError = error;
      }
    });
    encoder.configure(encoderConfig);

    let audioEncoder = null;
    let audioConfigured = false;
    if (audioMode === 'encoded') {
      audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => {
          const description = metadata?.decoderConfig?.description;
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const header = { timestamp: chunk.timestamp, duration: chunk.duration ?? 0 };
          pendingChunks += 1;
          sending = sending.then(async () => {
            if (!audioConfigured) {
              const bytes = description === undefined ? null : description instanceof ArrayBuffer
                ? new Uint8Array(description)
                : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
              await written(api.exportAudioConfig(bytes === null ? null : bytes.slice()));
              audioConfigured = true;
            }
            await written(api.exportAudioChunk(header, data));
          }).finally(() => {
            pendingChunks -= 1;
          });
          sending.catch(() => undefined);
        },
        error: (error) => {
          encodeError = error;
        }
      });
      audioEncoder.configure(audioConfig);
    }

    let audioSent = 0;
    const sendAudioUntil = async (seconds) => {
      if (soundtrack === null || audioMode === 'none') return;
      const until = Math.min(soundtrack[0].length, Math.round(seconds * sampleRate));
      const chunk = sampleRate; // at most a second per message
      while (audioSent < until) {
        const count = Math.min(chunk, until - audioSent);
        if (audioEncoder !== null) {
          const planar = new Float32Array(count * soundtrack.length);
          soundtrack.forEach((channel, index) => planar.set(channel.subarray(audioSent, audioSent + count), index * count));
          const data = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: count,
            numberOfChannels: soundtrack.length,
            timestamp: Math.round((audioSent / sampleRate) * 1e6),
            data: planar
          });
          audioSent += count;
          audioEncoder.encode(data);
          data.close();
          continue;
        }
        const data = interleave(soundtrack, audioSent, count);
        audioSent += count;
        await sending;
        await written(api.exportAudio(new Uint8Array(data.buffer)));
      }
    };

    try {
      for (let n = 0; n < frameCount; n += 1) {
        if (isCanceled()) throw new ExportCanceled();
        if (encodeError !== null) throw encodeError;
        const time = n / fps;
        const { time: sourceTime } = sourceAt(clips, offsets, time);
        const picture = await frames.frameAt(sourceTime);
        const cameraPicture = cameraFrames === null ? null : await cameraPictureAt(sourceTime);
        drawFrame(context, {
          video: picture,
          videoWidth: frames.width,
          videoHeight: frames.height,
          look: project.look,
          captions: project.captions, captionsEnabled: project.captionsEnabled,
          interactions: assets.interactions,
          time,
          sourceTime,
          events: derived.events,
          backgroundImage: assets.backgroundImage,
          cursorImages: assets.cursorImages,
          cameraVideo: cameraPicture,
          cameraWidth: cameraFrames?.width ?? 0,
          cameraHeight: cameraFrames?.height ?? 0,
          ...motionAt(derived.cameraTrack, derived.cursorTrack, clips, offsets, time, BLUR_FRAME)
        });
        const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1e6), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: n % Math.round(fps * KEYFRAME_SECONDS) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
        // Rendering waits while too many encoded frames are still being written.
        if (pendingChunks > MAX_PENDING_CHUNKS) await sending;
        await sendAudioUntil(time + AUDIO_AHEAD_SECONDS);
        if (n % 5 === 0) onProgress(n / frameCount);
      }
      await encoder.flush();
      await sending;
      await sendAudioUntil(total);
      if (audioEncoder !== null) await audioEncoder.flush();
      await sending;
      if (encodeError !== null) throw encodeError;
      onProgress(1);
      return await api.exportDone();
    } catch (error) {
      await sending.catch(() => undefined);
      await api.exportCancel();
      throw error;
    } finally {
      if (encoder.state !== 'closed') encoder.close();
      if (audioEncoder !== null && audioEncoder.state !== 'closed') audioEncoder.close();
    }
  }

  // The camera track may end a moment before the screen; it then disappears.
  // Any other problem reading it stops the export.
  async function cameraPictureAt(time) {
    try {
      return await cameraFrames.frameAt(time);
    } catch (error) {
      if (error instanceof Error && error.message === NO_FRAME) return null;
      throw error;
    }
  }
}
