export interface Rgba { r: number; g: number; b: number; a: number }
export interface Hsv { h: number; s: number; v: number }

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.exec(text);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map((digit) => digit.repeat(2)).join("") : hex[1];
    const channel = (offset: number) => parseInt(digits.slice(offset, offset + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u.exec(text);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
}

export function toHex(color: Pick<Rgba, "r" | "g" | "b">): string {
  return "#" + [color.r, color.g, color.b].map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function formatColor(color: Rgba): string {
  return color.a >= 1 ? toHex(color) : `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${Number(color.a.toFixed(4))})`;
}

export function rgbToHsv(color: Pick<Rgba, "r" | "g" | "b">): Hsv {
  const [red, green, blue] = [color.r, color.g, color.b].map((channel) => clamp(channel, 0, 255) / 255);
  const high = Math.max(red, green, blue);
  const delta = high - Math.min(red, green, blue);
  let hue = 0;
  if (delta > 0) hue = high === red ? (green - blue) / delta : high === green ? 2 + (blue - red) / delta : 4 + (red - green) / delta;
  return { h: ((hue * 60) % 360 + 360) % 360, s: high > 0 ? delta / high : 0, v: high };
}

export function hsvToRgb(color: Hsv): Pick<Rgba, "r" | "g" | "b"> {
  const hue = ((color.h % 360) + 360) % 360;
  const saturation = clamp(color.s);
  const brightness = clamp(color.v);
  const channel = (offset: number) => {
    const position = (offset + hue / 60) % 6;
    return Math.round(255 * brightness * (1 - saturation * Math.max(0, Math.min(position, 4 - position, 1))));
  };
  return { r: channel(5), g: channel(3), b: channel(1) };
}

/** Source colors use unsigned 0xAABBGGRR, including fully transparent colors. */
export function unpackSourceColor(value: number): Rgba {
  const packed = value >>> 0;
  return { r: packed & 255, g: (packed >>> 8) & 255, b: (packed >>> 16) & 255, a: (packed >>> 24) / 255 };
}

export function packSourceColor(color: Rgba): number {
  const channel = (value: number) => Math.round(clamp(value, 0, 255));
  return ((Math.round(clamp(color.a) * 255) << 24) | (channel(color.b) << 16) | (channel(color.g) << 8) | channel(color.r)) >>> 0;
}
