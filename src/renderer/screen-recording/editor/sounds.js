// Click and typing sounds, made in code so they need no sound files. Each
// sound is the same every time for the same key press, so the preview and the
// export sound identical.

const KEY_VARIANTS = 8;
const PEAK = 0.8;

// Small repeatable random numbers, so a key press always sounds the same.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function build(sampleRate, seconds, sample) {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = sample(i / sampleRate, i);
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < length; i += 1) data[i] *= PEAK / peak;
  // Short fade-out so no sound ends in a click of its own.
  const fade = Math.min(length, Math.round(sampleRate * 0.003));
  for (let i = 0; i < fade; i += 1) data[length - 1 - i] *= i / fade;
  return data;
}

// Filtered noise: `smooth` near 1 is dull, near 0 is bright.
function noise(seed, smooth) {
  const next = random(seed);
  let low = 0;
  return () => {
    const white = next() * 2 - 1;
    low = low * smooth + white * (1 - smooth);
    return smooth > 0.5 ? low : white - low;
  };
}

export function clickSound(style, sampleRate) {
  if (style === 'soft') {
    const hiss = noise(11, 0.82);
    return build(sampleRate, 0.05, (t) => hiss() * Math.exp(-t * 90) + 0.35 * Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 160));
  }
  if (style === 'crisp') {
    const hiss = noise(23, 0.3);
    return build(sampleRate, 0.03, (t) => hiss() * Math.exp(-t * 260) + 0.5 * Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t * 300));
  }
  if (style === 'pop') {
    let phase = 0;
    return build(sampleRate, 0.09, (t) => {
      const frequency = 320 + 700 * Math.exp(-t * 45);
      phase += (2 * Math.PI * frequency) / sampleRate;
      return Math.sin(phase) * Math.exp(-t * 40);
    });
  }
  return null;
}

export function typingSound(style, sampleRate, variant) {
  const vary = random(97 + variant * 131);
  const pitch = 0.9 + vary() * 0.2;
  if (style === 'soft') {
    const hiss = noise(300 + variant, 0.9);
    return build(sampleRate, 0.06, (t) => hiss() * Math.exp(-t * 70 * pitch));
  }
  if (style === 'mechanical') {
    const bright = noise(500 + variant, 0.2);
    const body = noise(700 + variant, 0.92);
    return build(sampleRate, 0.08, (t) => {
      const click = bright() * Math.exp(-t * 420);
      const thock = t < 0.012 ? 0 : (0.9 * Math.sin(2 * Math.PI * 190 * pitch * (t - 0.012)) + body()) * Math.exp(-(t - 0.012) * 75);
      return 0.7 * click + thock;
    });
  }
  if (style === 'typewriter') {
    const hit = noise(900 + variant, 0.15);
    return build(sampleRate, 0.1, (t) => hit() * Math.exp(-t * 300) + 0.45 * Math.sin(2 * Math.PI * 2600 * pitch * t) * Math.exp(-t * 55));
  }
  return null;
}

// Sounds for one look, ready to mix or play.
export function soundSet(look, sampleRate) {
  const click = clickSound(look.clickSound, sampleRate);
  const keys = look.typingSound === 'none' ? [] : Array.from({ length: KEY_VARIANTS }, (_, i) => typingSound(look.typingSound, sampleRate, i));
  return { click, keys };
}

// Which recorded key sound plays for the n-th key press.
export function keyVariant(index) {
  return (index * 5 + 3) % KEY_VARIANTS;
}

// Adds click and typing sounds at their moments on the edited timeline.
// `channels` is the edited soundtrack (planar), or null when there is none.
export function mixSoundEffects(channels, sampleRate, totalSeconds, events, look) {
  const sounds = soundSet(look, sampleRate);
  const clicks = sounds.click === null ? [] : events.clicks;
  const keys = sounds.keys.length === 0 ? [] : events.keys;
  if (clicks.length === 0 && keys.length === 0) return channels;
  const length = Math.max(1, Math.round(totalSeconds * sampleRate));
  const out = channels ?? [new Float32Array(length)];
  const add = (sound, time, gain) => {
    const at = Math.round(time * sampleRate);
    for (const channel of out) {
      for (let i = 0; i < sound.length && at + i < channel.length; i += 1) {
        if (at + i >= 0) channel[at + i] += sound[i] * gain;
      }
    }
  };
  for (const click of clicks) add(sounds.click, click.t, look.clickVolume);
  keys.forEach((key, index) => add(sounds.keys[keyVariant(index)], key.t, look.typingVolume));
  // Keep loud moments from clipping.
  for (const channel of out) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i];
      if (value > 0.95 || value < -0.95) channel[i] = Math.tanh(value);
    }
  }
  return out;
}
