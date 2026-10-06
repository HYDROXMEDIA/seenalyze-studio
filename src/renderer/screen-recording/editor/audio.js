// Builds the edited soundtrack: the kept parts of the recording in order, with
// sped-up or slowed parts time-stretched so voices keep their pitch.

const WINDOW_SECONDS = 0.03;
const SEEK_SECONDS = 0.012;
const FADE_SECONDS = 0.004;

function hann(length) {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  return window;
}

// Where the next piece of input fits best with what was already written,
// searched near the expected position (waveform similarity overlap-add).
function bestOffset(mono, expected, reference, overlap, seek) {
  let best = expected;
  let bestScore = -Infinity;
  const from = Math.max(0, expected - seek);
  const to = Math.min(mono.length - overlap - 1, expected + seek);
  for (let offset = from; offset <= to; offset += 2) {
    let score = 0;
    for (let i = 0; i < overlap; i += 4) score += mono[offset + i] * reference[i];
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  return best;
}

function resample(channel, length) {
  const out = new Float32Array(length);
  const step = length > 1 ? (channel.length - 1) / (length - 1) : 0;
  for (let i = 0; i < length; i += 1) {
    const at = i * step;
    const low = Math.floor(at);
    const high = Math.min(channel.length - 1, low + 1);
    out[i] = channel[low] + (channel[high] - channel[low]) * (at - low);
  }
  return out;
}

// Stretches planar channels to `1 / rate` of their length without changing pitch.
export function timeStretch(channels, sampleRate, rate) {
  const length = channels[0]?.length ?? 0;
  const outLength = Math.max(0, Math.round(length / rate));
  if (rate === 1 || length === 0) return channels.map((channel) => channel.slice());
  const size = Math.max(64, Math.round(WINDOW_SECONDS * sampleRate) & ~1);
  // Too short to stretch piece by piece: resample it instead.
  if (length < size * 2) return channels.map((channel) => resample(channel, outLength));
  const hop = size / 2;
  const seek = Math.round(SEEK_SECONDS * sampleRate);
  const window = hann(size);
  const out = channels.map(() => new Float32Array(outLength + size));
  const weight = new Float32Array(outLength + size);
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i += 1) mono[i] += channel[i] / channels.length;

  let previous = 0;
  for (let written = 0; written < outLength; written += hop) {
    const expected = Math.min(length - size, Math.round(written * rate));
    if (expected < 0) break;
    // Match against the natural continuation of the previous piece.
    const reference = mono.subarray(Math.min(length - size, previous + hop), Math.min(length - size, previous + hop) + hop);
    const offset = written === 0 ? expected : bestOffset(mono, expected, reference, Math.min(hop, reference.length), seek);
    for (let c = 0; c < channels.length; c += 1) {
      const source = channels[c];
      const target = out[c];
      for (let i = 0; i < size && offset + i < length; i += 1) target[written + i] += source[offset + i] * window[i];
    }
    for (let i = 0; i < size; i += 1) weight[written + i] += window[i];
    previous = offset;
  }
  return out.map((channel) => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i += 1) result[i] = weight[i] > 1e-3 ? channel[i] / weight[i] : 0;
    return result;
  });
}

// Joins the kept parts of `channels` (planar PCM of the whole recording) into
// the edited soundtrack. Short fades at each join avoid clicks.
export function assembleSoundtrack(channels, sampleRate, clips) {
  const pieces = clips.map((clip) => {
    const from = Math.max(0, Math.round(clip.start * sampleRate));
    const to = Math.min(channels[0].length, Math.round(clip.end * sampleRate));
    const slice = channels.map((channel) => channel.subarray(from, Math.max(from, to)));
    const expected = Math.round(((clip.end - clip.start) / clip.speed) * sampleRate);
    const stretched = timeStretch(slice, sampleRate, clip.speed);
    // Exact length keeps sound and picture aligned clip by clip.
    return stretched.map((channel) => {
      const fitted = new Float32Array(expected);
      fitted.set(channel.subarray(0, expected));
      return fitted;
    });
  });
  const total = pieces.reduce((sum, piece) => sum + piece[0].length, 0);
  const fade = Math.round(FADE_SECONDS * sampleRate);
  return channels.map((_, c) => {
    const out = new Float32Array(total);
    let at = 0;
    for (const piece of pieces) {
      const data = piece[c];
      out.set(data, at);
      for (let i = 0; i < fade && i < data.length; i += 1) {
        const gain = i / fade;
        out[at + i] *= gain;
        out[at + data.length - 1 - i] *= gain;
      }
      at += data.length;
    }
    return out;
  });
}

// Interleaves `frames` samples of planar channels starting at `from`.
export function interleave(channels, from, frames) {
  const count = channels.length;
  const out = new Float32Array(frames * count);
  for (let c = 0; c < count; c += 1) {
    const channel = channels[c];
    for (let i = 0; i < frames; i += 1) out[i * count + c] = channel[from + i] ?? 0;
  }
  return out;
}
