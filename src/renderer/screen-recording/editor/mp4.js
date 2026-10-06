// Reads the sample tables of an MP4 file (H.264 video, AAC audio) so frames can
// be decoded one by one. `read(offset, length)` returns bytes of the file, so
// long recordings never have to be loaded whole. Fragmented files (written in
// pieces while recording in the browser) are not read here; null is returned.

const decoder = new TextDecoder('latin1');

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(at) { return this.view.getUint8(at); }
  u16(at) { return this.view.getUint16(at); }
  u32(at) { return this.view.getUint32(at); }
  i32(at) { return this.view.getInt32(at); }
  u64(at) { return Number(this.view.getBigUint64(at)); }
  i64(at) { return Number(this.view.getBigInt64(at)); }
  type(at) { return decoder.decode(this.bytes.subarray(at, at + 4)); }

  // Child boxes of the range [start, end).
  *boxes(start, end) {
    let at = start;
    while (at + 8 <= end) {
      let size = this.u32(at);
      const type = this.type(at + 4);
      let header = 8;
      if (size === 1) {
        size = this.u64(at + 8);
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return;
      yield { type, start: at + header, end: at + size };
      at += size;
    }
  }

  find(start, end, ...path) {
    let range = { start, end };
    for (const type of path) {
      let found = null;
      for (const box of this.boxes(range.start, range.end)) {
        if (box.type === type) {
          found = box;
          break;
        }
      }
      if (found === null) return null;
      range = found;
    }
    return range;
  }
}

// Top-level boxes, read header by header.
async function topLevel(read, size) {
  const boxes = [];
  let at = 0;
  while (at + 8 <= size) {
    const header = new Reader(await read(at, Math.min(16, size - at)));
    let length = header.u32(0);
    const type = header.type(4);
    if (length === 1) length = header.u64(8);
    else if (length === 0) length = size - at;
    if (length < 8) break;
    boxes.push({ type, offset: at, size: length });
    at += length;
  }
  return boxes;
}

function descriptorLength(reader, at) {
  let length = 0;
  let bytes = 0;
  for (; bytes < 4; bytes += 1) {
    const value = reader.u8(at + bytes);
    length = (length << 7) | (value & 0x7f);
    if ((value & 0x80) === 0) break;
  }
  return { length, header: bytes + 1 };
}

// The AAC decoder setup bytes inside an esds box.
function audioSpecificConfig(reader, box) {
  let at = box.start + 4;
  const end = box.end;
  while (at < end) {
    const tag = reader.u8(at);
    const { length, header } = descriptorLength(reader, at + 1);
    const body = at + 1 + header;
    if (tag === 0x03) {
      const flags = reader.u8(body + 2);
      let next = body + 3;
      if (flags & 0x80) next += 2;
      if (flags & 0x40) next += 1 + reader.u8(next);
      if (flags & 0x20) next += 2;
      at = next;
    } else if (tag === 0x04) {
      at = body + 13;
    } else if (tag === 0x05) {
      return reader.bytes.slice(body, body + length);
    } else {
      at = body + length;
    }
  }
  return null;
}

function readTrack(reader, trak, movieTimescale) {
  const mdhd = reader.find(trak.start, trak.end, 'mdia', 'mdhd');
  const hdlr = reader.find(trak.start, trak.end, 'mdia', 'hdlr');
  const stbl = reader.find(trak.start, trak.end, 'mdia', 'minf', 'stbl');
  if (mdhd === null || hdlr === null || stbl === null) return null;
  const version = reader.u8(mdhd.start);
  const timescale = version === 1 ? reader.u32(mdhd.start + 20) : reader.u32(mdhd.start + 12);
  const handler = reader.type(hdlr.start + 8);
  if (handler !== 'vide' && handler !== 'soun') return null;

  const stsd = reader.find(stbl.start, stbl.end, 'stsd');
  if (stsd === null) return null;
  const entry = reader.boxes(stsd.start + 8, stsd.end).next().value;
  if (entry === undefined) return null;
  const track = { kind: handler === 'vide' ? 'video' : 'audio', timescale };

  if (track.kind === 'video') {
    if (entry.type !== 'avc1' && entry.type !== 'avc3') return null;
    track.width = reader.u16(entry.start + 24);
    track.height = reader.u16(entry.start + 26);
    const avcC = reader.find(entry.start + 78, entry.end, 'avcC');
    if (avcC === null) return null;
    track.description = reader.bytes.slice(avcC.start, avcC.end);
    const hex = (value) => value.toString(16).padStart(2, '0');
    track.codec = `${entry.type}.${hex(track.description[1])}${hex(track.description[2])}${hex(track.description[3])}`;
  } else {
    if (entry.type !== 'mp4a') return null;
    const soundVersion = reader.u16(entry.start + 8);
    track.channels = reader.u16(entry.start + 16);
    track.sampleRate = reader.u32(entry.start + 24) >>> 16;
    const children = entry.start + 28 + (soundVersion === 1 ? 16 : soundVersion === 2 ? 36 : 0);
    const esds = reader.find(children, entry.end, 'esds');
    track.description = esds === null ? null : audioSpecificConfig(reader, esds);
    if (track.description === null) return null;
    track.codec = 'mp4a.40.2';
  }

  // Sample tables.
  const table = (type) => reader.find(stbl.start, stbl.end, type);
  const stts = table('stts');
  const stsz = table('stsz');
  const stsc = table('stsc');
  const stco = table('stco');
  const co64 = table('co64');
  const ctts = table('ctts');
  const stss = table('stss');
  if (stts === null || stsz === null || stsc === null || (stco === null && co64 === null)) return null;

  const fixedSize = reader.u32(stsz.start + 4);
  const count = reader.u32(stsz.start + 8);
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) sizes[i] = fixedSize !== 0 ? fixedSize : reader.u32(stsz.start + 12 + i * 4);

  const dts = new Float64Array(count);
  let sample = 0;
  let time = 0;
  const sttsCount = reader.u32(stts.start + 4);
  for (let i = 0; i < sttsCount && sample < count; i += 1) {
    const repeat = reader.u32(stts.start + 8 + i * 8);
    const delta = reader.u32(stts.start + 12 + i * 8);
    for (let j = 0; j < repeat && sample < count; j += 1) {
      dts[sample] = time;
      time += delta;
      sample += 1;
    }
  }
  const mediaDuration = time;

  const composition = new Float64Array(count);
  if (ctts !== null) {
    const cttsCount = reader.u32(ctts.start + 4);
    sample = 0;
    for (let i = 0; i < cttsCount && sample < count; i += 1) {
      const repeat = reader.u32(ctts.start + 8 + i * 8);
      // Some writers store negative offsets even in version 0, so read them signed.
      const offset = reader.i32(ctts.start + 12 + i * 8);
      for (let j = 0; j < repeat && sample < count; j += 1) composition[sample++] = offset;
    }
  }

  const chunkOffsets = [];
  if (stco !== null) {
    const n = reader.u32(stco.start + 4);
    for (let i = 0; i < n; i += 1) chunkOffsets.push(reader.u32(stco.start + 8 + i * 4));
  } else {
    const n = reader.u32(co64.start + 4);
    for (let i = 0; i < n; i += 1) chunkOffsets.push(reader.u64(co64.start + 8 + i * 8));
  }
  const offsets = new Float64Array(count);
  const stscCount = reader.u32(stsc.start + 4);
  sample = 0;
  for (let i = 0; i < stscCount; i += 1) {
    const firstChunk = reader.u32(stsc.start + 8 + i * 12) - 1;
    const perChunk = reader.u32(stsc.start + 12 + i * 12);
    const nextFirst = i + 1 < stscCount ? reader.u32(stsc.start + 8 + (i + 1) * 12) - 1 : chunkOffsets.length;
    for (let chunk = firstChunk; chunk < nextFirst && sample < count; chunk += 1) {
      let at = chunkOffsets[chunk];
      for (let j = 0; j < perChunk && sample < count; j += 1) {
        offsets[sample] = at;
        at += sizes[sample];
        sample += 1;
      }
    }
  }

  const sync = new Uint8Array(count);
  if (stss === null) {
    sync.fill(1);
  } else {
    const n = reader.u32(stss.start + 4);
    for (let i = 0; i < n; i += 1) {
      const index = reader.u32(stss.start + 8 + i * 4) - 1;
      if (index >= 0 && index < count) sync[index] = 1;
    }
  }

  // Edit list: an empty edit delays the track; the first real edit says where
  // in the media the presentation starts.
  let delay = 0;
  let mediaStart = 0;
  const elst = reader.find(trak.start, trak.end, 'edts', 'elst');
  if (elst !== null) {
    const elstVersion = reader.u8(elst.start);
    const n = reader.u32(elst.start + 4);
    const size = elstVersion === 1 ? 20 : 12;
    for (let i = 0; i < n; i += 1) {
      const at = elst.start + 8 + i * size;
      const segment = elstVersion === 1 ? reader.u64(at) : reader.u32(at);
      const mediaTime = elstVersion === 1 ? reader.i64(at + 8) : reader.i32(at + 4);
      if (mediaTime === -1) {
        delay += segment / movieTimescale;
      } else {
        mediaStart = mediaTime;
        break;
      }
    }
  }

  track.samples = Array.from({ length: count }, (_, i) => ({
    offset: offsets[i],
    size: sizes[i],
    time: (dts[i] + composition[i] - mediaStart) / timescale + delay,
    decodeTime: (dts[i] - mediaStart) / timescale + delay,
    duration: ((i + 1 < count ? dts[i + 1] : mediaDuration) - dts[i]) / timescale,
    key: sync[i] === 1
  }));
  track.skipSamples = track.kind === 'audio' ? Math.max(0, Math.round((mediaStart / timescale) * track.sampleRate)) : 0;
  return track;
}

export async function openMp4(read, size) {
  const boxes = await topLevel(read, size);
  const moovBox = boxes.find((box) => box.type === 'moov');
  if (moovBox === undefined || boxes.some((box) => box.type === 'moof')) return null;
  const reader = new Reader(await read(moovBox.offset, moovBox.size));
  const moov = { start: 8, end: moovBox.size };
  if (reader.find(moov.start, moov.end, 'mvex') !== null) return null;
  const mvhd = reader.find(moov.start, moov.end, 'mvhd');
  if (mvhd === null) return null;
  const movieTimescale = reader.u8(mvhd.start) === 1 ? reader.u32(mvhd.start + 20) : reader.u32(mvhd.start + 12);
  let video = null;
  let audio = null;
  for (const box of reader.boxes(moov.start, moov.end)) {
    if (box.type !== 'trak') continue;
    const track = readTrack(reader, box, movieTimescale);
    if (track?.kind === 'video' && video === null) video = track;
    if (track?.kind === 'audio' && audio === null) audio = track;
  }
  // A track without frames, or whose sample table points outside the file, cannot be read here.
  if (video === null || video.samples.length === 0) return null;
  const inFile = (track) => track.samples.every((sample) => Number.isFinite(sample.offset) && sample.offset + sample.size <= size);
  if (!inFile(video)) return null;
  return { video, audio: audio !== null && audio.samples.length > 0 && inFile(audio) ? audio : null };
}

// Reads the bytes of consecutive samples in few large reads.
export async function* sampleData(read, samples, from, to, maxRead = 8 * 1024 * 1024) {
  let index = from;
  while (index < to) {
    const start = samples[index].offset;
    let end = index;
    let length = samples[index].size;
    while (end + 1 < to && samples[end + 1].offset === samples[end].offset + samples[end].size && length + samples[end + 1].size <= maxRead) {
      end += 1;
      length += samples[end].size;
    }
    const bytes = await read(start, length);
    let at = 0;
    for (let i = index; i <= end; i += 1) {
      yield { index: i, sample: samples[i], data: bytes.subarray(at, at + samples[i].size) };
      at += samples[i].size;
    }
    index = end + 1;
  }
}
