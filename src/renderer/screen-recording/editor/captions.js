export function normalizeCaptions(value, duration = Infinity) {
  const result = [];
  for (const item of (Array.isArray(value) ? value : []).filter(x => x && Number.isFinite(x.start) && Number.isFinite(x.end) && typeof x.text === 'string').sort((a, b) => a.start - b.start).slice(0, 20000)) {
    const start = Math.max(0, item.start, result.at(-1)?.end ?? 0);
    const end = Math.min(duration, item.end);
    const text = item.text.trim().slice(0, 2000);
    if (end > start && text) result.push({ start, end, text });
  }
  return result;
}

export function mapCaptions(captions, clips) {
  const result = []; let offset = 0;
  for (const clip of clips) {
    const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
    for (const caption of captions) {
      const start = Math.max(clip.start, caption.start); const end = Math.min(clip.end, caption.end);
      if (end > start) result.push({ start: offset + (start - clip.start) / speed, end: offset + (end - clip.start) / speed, text: caption.text });
    }
    offset += (clip.end - clip.start) / speed;
  }
  return result;
}

export function subtitleText(captions, clips, format = 'srt') {
  const stamp = time => {
    const ms = Math.max(0, Math.round(time * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'vtt' ? '.' : ','}${String(ms % 1000).padStart(3, '0')}`;
  };
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + mapCaptions(captions, clips).map((caption, index) => `${format === 'vtt' ? '' : `${index + 1}\n`}${stamp(caption.start)} --> ${stamp(caption.end)}\n${caption.text.replace(/-->/g, '→')}\n`).join('\n');
}
