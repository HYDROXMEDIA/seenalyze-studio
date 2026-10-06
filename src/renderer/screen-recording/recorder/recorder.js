import { initI18n } from '../shared/i18n.js';

initI18n();

const api = window.recordingRecorder;
const timeElement = document.getElementById('time');
const stopButton = document.getElementById('stop');

const RESOLUTION_HEIGHT = { native: Infinity, 2160: 2160, 1440: 1440, 1080: 1080, 720: 720 };
const MIME_TYPES = {
  mp4: ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
};
const AUDIO_MIME_TYPES = {
  mp4: ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
};

let recorder = null;
let stream = null;
let drawTimer = 0;
let clockTimer = 0;
let stopping = false;
let audioContext = null;
const audioStreams = [];

// The microphone track, or null when it is off or cannot start (the video still records).
async function audioTrack(config) {
  const sources = stream?.getAudioTracks().length ? [new MediaStream(stream.getAudioTracks())] : [];
  if (config.micId !== null) {
    try {
      const name = await api.safeMicrophone(config.micLabel || 'default');
      if (name === null) throw new Error('Microphone unavailable');
      const devices = await navigator.mediaDevices.enumerateDevices();
      const deviceId = name === 'default' ? config.micId : devices.find((device) => device.kind === 'audioinput' && device.label === name)?.deviceId;
      if (!deviceId) throw new Error('Microphone unavailable');
      sources.push(await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }));
    } catch (error) {
      console.warn('Microphone unavailable', error);
    }
  }
  if (sources.length === 0) return null;
  audioStreams.push(...sources);
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  for (const source of sources) { const gain = audioContext.createGain(); gain.gain.value = sources.length > 1 ? 0.7 : 1; audioContext.createMediaStreamSource(source).connect(gain).connect(destination); }
  return destination.stream.getAudioTracks()[0] ?? null;
}

function pickMimeType(format, withAudio) {
  const table = withAudio ? AUDIO_MIME_TYPES : MIME_TYPES;
  const preferred = table[format].find((type) => MediaRecorder.isTypeSupported(type));
  if (preferred) return { mimeType: preferred, extension: format };
  // Fall back to the other format when this Mac cannot write the chosen one.
  const other = format === 'mp4' ? 'webm' : 'mp4';
  const fallback = table[other].find((type) => MediaRecorder.isTypeSupported(type));
  return fallback ? { mimeType: fallback, extension: other } : null;
}

// Largest even size that fits the chosen resolution, keeping the aspect ratio.
function outputSize(width, height, resolution) {
  const scale = Math.min(1, RESOLUTION_HEIGHT[resolution] / height);
  const even = (value) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function cleanup() {
  window.clearInterval(drawTimer);
  window.clearInterval(clockTimer);
  for (const track of stream?.getTracks() ?? []) track.stop();
  for (const source of audioStreams) source.getTracks().forEach((track) => track.stop());
  void audioContext?.close().catch(() => undefined);
}

async function sourceStream(config, size) {
  return navigator.mediaDevices.getUserMedia({
    audio: config.systemAudio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: config.sourceId } } : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: config.sourceId,
        maxWidth: size.width,
        maxHeight: size.height,
        maxFrameRate: config.fps
      }
    }
  });
}

// Area recordings capture the display and crop the selection on a canvas.
async function croppedStream(config) {
  const display = await sourceStream(config, { width: 16384, height: 16384 });
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = display;
  await video.play();
  // The stream can arrive at another size than expected (for example a scaled
  // display mode), so the crop is scaled to the picture actually received.
  const scaleX = video.videoWidth > 0 && config.sourceSize.width > 0 ? video.videoWidth / config.sourceSize.width : 1;
  const scaleY = video.videoHeight > 0 && config.sourceSize.height > 0 ? video.videoHeight / config.sourceSize.height : 1;
  const x = Math.max(0, Math.min(video.videoWidth - 2, config.crop.x * scaleX));
  const y = Math.max(0, Math.min(video.videoHeight - 2, config.crop.y * scaleY));
  const crop = {
    x,
    y,
    width: Math.max(2, Math.min(video.videoWidth - x, config.crop.width * scaleX)),
    height: Math.max(2, Math.min(video.videoHeight - y, config.crop.height * scaleY))
  };
  const size = outputSize(config.crop.width, config.crop.height, config.resolution);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  const draw = () => context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  draw();
  drawTimer = window.setInterval(draw, 1000 / config.fps);
  const output = canvas.captureStream(config.fps);
  for (const track of display.getAudioTracks()) output.addTrack(track);
  // Stop the display capture together with the canvas stream.
  output.getVideoTracks()[0].addEventListener('ended', () => display.getTracks().forEach((track) => track.stop()));
  return { stream: output, size, release: () => display.getTracks().forEach((track) => track.stop()) };
}

async function start() {
  const config = await api.init();
  if (!config) {
    api.error('Recording is unavailable');
    return;
  }
  let release = () => undefined;
  let size;
  if (config.crop !== null) {
    const cropped = await croppedStream(config);
    stream = cropped.stream;
    size = cropped.size;
    release = cropped.release;
  } else {
    size = outputSize(config.sourceSize.width, config.sourceSize.height, config.resolution);
    stream = await sourceStream(config, size);
  }

  const sound = await audioTrack(config);
  if (sound !== null) stream = new MediaStream([...stream.getVideoTracks(), sound]);
  const type = pickMimeType(config.format, sound !== null);
  if (type === null) {
    release();
    cleanup();
    api.error('Video recording is not supported');
    return;
  }

  if (!(await api.begin(type.extension))) {
    release();
    api.error('The video file could not be created');
    return;
  }

  const bitrate = Math.min(40_000_000, Math.max(2_500_000, Math.round(size.width * size.height * config.fps * 0.12)));
  recorder = new MediaRecorder(stream, { mimeType: type.mimeType, videoBitsPerSecond: bitrate });
  // Chunks are sent strictly in order, and the file is finished only after the last one.
  let sending = Promise.resolve();
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) return;
    const data = event.data;
    sending = sending.then(async () => api.chunk(new Uint8Array(await data.arrayBuffer())));
  });
  recorder.addEventListener('stop', () => {
    release();
    cleanup();
    void sending.then(() => api.done(), (error) => api.error(error instanceof Error ? error.message : String(error)));
  });
  recorder.addEventListener('error', (event) => {
    release();
    cleanup();
    api.error(event.error?.message ?? 'Recording error');
  });
  // The source ending (for example the window closing) finishes the video.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => stopRecording());

  recorder.start(1000);
  api.started();
  const startedAt = Date.now();
  document.body.dataset.state = 'recording';
  clockTimer = window.setInterval(() => {
    timeElement.textContent = formatTime(Math.floor((Date.now() - startedAt) / 1000));
  }, 250);
}

function stopRecording() {
  if (stopping) return;
  stopping = true;
  stopButton.disabled = true;
  document.body.dataset.state = 'saving';
  if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
  else {
    cleanup();
    api.done();
  }
}

stopButton.addEventListener('click', () => api.stop());
api.onPause(() => {
  if (recorder !== null && recorder.state === 'recording') recorder.pause();
});
api.onResume(() => {
  if (recorder !== null && recorder.state === 'paused') recorder.resume();
});
api.onRequestStop(stopRecording);

start().catch((error) => {
  cleanup();
  api.error(error instanceof Error ? error.message : String(error));
});
