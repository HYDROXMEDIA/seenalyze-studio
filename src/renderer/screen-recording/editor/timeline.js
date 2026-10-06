// The editor timeline: the recording laid out in source time, with the kept
// clips (cut parts shaded) on one track and zooms on another. Clips and zooms
// are selected by clicking, trimmed or resized by their edges, and zooms are
// moved by dragging.

import { MIN_CLIP, MIN_ZOOM_LENGTH } from './engine.js';

const EDGE_PIXELS = 7;

export function createTimeline(root, options) {
  const { duration, labels, onSeek, onSelect, onEditStart, onEdit, onEditEnd } = options;
  const clipsTrack = root.querySelector('[data-track="clips"]');
  const zoomsTrack = root.querySelector('[data-track="zooms"]');
  const playhead = root.querySelector('.playhead');
  const ruler = root.querySelector('.ruler');
  let model = { clips: [], zooms: [], selection: null, speedLabel: (speed) => `${speed}×` };

  const rtl = () => document.documentElement.dir === 'rtl';
  const percent = (time) => `${(time / duration) * 100}%`;

  function timeAt(clientX) {
    const bounds = clipsTrack.getBoundingClientRect();
    let fraction = (clientX - bounds.left) / bounds.width;
    if (rtl()) fraction = 1 - fraction;
    return Math.min(duration, Math.max(0, fraction * duration));
  }

  function secondsPerPixel() {
    return duration / Math.max(1, clipsTrack.getBoundingClientRect().width);
  }

  // Which part of a block the pointer grabbed: its start edge, end edge, or body.
  function grabPart(event, element) {
    const bounds = element.getBoundingClientRect();
    const fromLeft = event.clientX - bounds.left;
    const fromRight = bounds.right - event.clientX;
    const edge = Math.min(EDGE_PIXELS, bounds.width / 3);
    const startEdge = rtl() ? fromRight <= edge : fromLeft <= edge;
    const endEdge = rtl() ? fromLeft <= edge : fromRight <= edge;
    if (startEdge) return 'start';
    if (endEdge) return 'end';
    return 'body';
  }

  function drag(event, handlers) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    let moved = false;
    const move = (next) => {
      const delta = (next.clientX - startX) * secondsPerPixel() * (rtl() ? -1 : 1);
      if (!moved && Math.abs(next.clientX - startX) < 3) return;
      if (!moved) onEditStart();
      moved = true;
      handlers.move(delta, next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (moved) onEditEnd();
      else handlers.click?.();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function updateClip(block, index) {
    const clip = model.clips[index];
    block.style.insetInlineStart = percent(clip.start);
    block.style.width = percent(clip.end - clip.start);
    block.setAttribute('aria-label', labels.clip(index + 1));
    block.setAttribute('aria-pressed', String(model.selection?.kind === 'clip' && model.selection.index === index));
    block.firstChild.textContent = clip.speed === 1 ? '' : model.speedLabel(clip.speed);
  }

  function clipBlock(index) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'block block--clip';
    const speed = document.createElement('span');
    speed.className = 'block-label';
    block.append(speed);
    block.addEventListener('pointermove', (event) => {
      const part = grabPart(event, block);
      block.style.cursor = part === 'body' ? 'default' : 'ew-resize';
    });
    // Enter or Space selects it from the keyboard.
    block.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      onSelect({ kind: 'clip', index });
      onSeek(model.clips[index].start);
    });
    block.addEventListener('pointerdown', (event) => {
      const part = grabPart(event, block);
      const original = { ...model.clips[index] };
      const previous = model.clips[index - 1];
      const next = model.clips[index + 1];
      drag(event, {
        click: () => {
          onSelect({ kind: 'clip', index });
          onSeek(timeAt(event.clientX));
        },
        move: (delta) => {
          if (part === 'start') {
            const start = Math.min(original.end - MIN_CLIP, Math.max(previous?.end ?? 0, original.start + delta));
            onEdit((draft) => { draft.clips[index].start = start; });
            onSeek(start);
          } else if (part === 'end') {
            const end = Math.max(original.start + MIN_CLIP, Math.min(next?.start ?? duration, original.end + delta));
            onEdit((draft) => { draft.clips[index].end = end; });
            onSeek(end);
          }
        }
      });
    });
    return block;
  }

  function updateZoom(block, zoom) {
    block.style.insetInlineStart = percent(zoom.start);
    block.style.width = percent(zoom.end - zoom.start);
    block.setAttribute('aria-label', labels.zoom(zoom.scale));
    block.setAttribute('aria-pressed', String(model.selection?.kind === 'zoom' && model.selection.id === zoom.id));
    block.firstChild.textContent = model.speedLabel(Math.round(zoom.scale * 10) / 10);
  }

  function zoomBlock(id) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'block block--zoom';
    block.dataset.id = id;
    const label = document.createElement('span');
    label.className = 'block-label';
    block.append(label);
    block.addEventListener('pointermove', (event) => {
      const part = grabPart(event, block);
      block.style.cursor = part === 'body' ? 'grab' : 'ew-resize';
    });
    block.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      onSelect({ kind: 'zoom', id });
      const zoom = model.zooms.find((entry) => entry.id === id);
      if (zoom !== undefined) onSeek(zoom.start);
    });
    block.addEventListener('pointerdown', (event) => {
      const part = grabPart(event, block);
      const zoom = model.zooms.find((entry) => entry.id === id);
      if (zoom === undefined) return;
      const original = { ...zoom };
      const length = original.end - original.start;
      // Zooms never overlap: moving and resizing stop at the neighbours.
      const others = model.zooms.filter((entry) => entry.id !== id);
      const before = Math.max(0, ...others.filter((entry) => entry.start < original.start).map((entry) => entry.end));
      const after = Math.min(duration, ...others.filter((entry) => entry.start >= original.start).map((entry) => entry.start));
      drag(event, {
        click: () => onSelect({ kind: 'zoom', id }),
        move: (delta) => {
          onEdit((draft) => {
            const target = draft.zooms.find((entry) => entry.id === id);
            if (target === undefined) return;
            if (part === 'start') {
              target.start = Math.min(original.end - MIN_ZOOM_LENGTH, Math.max(before, original.start + delta));
            } else if (part === 'end') {
              target.end = Math.max(original.start + MIN_ZOOM_LENGTH, Math.min(after, original.end + delta));
            } else {
              const start = Math.min(after - length, Math.max(before, original.start + delta));
              target.start = start;
              target.end = start + length;
            }
            target.edited = true;
            // The planned focus moment keeps its place inside the zoom.
            target.focusAt = Math.min(target.end, Math.max(target.start, original.focusAt + (target.start - original.start)));
          });
        }
      });
    });
    return block;
  }

  function buildRuler() {
    ruler.replaceChildren();
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((value) => duration / value <= 12) ?? 600;
    for (let time = 0; time <= duration; time += step) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.insetInlineStart = percent(time);
      tick.textContent = labels.time(time);
      ruler.append(tick);
    }
  }

  // From the keyboard: Shift+Arrow moves a block's start, Option+Arrow its end,
  // Shift+Option+Arrow the whole zoom, by a tenth of a second.
  const NUDGE = 0.1;
  root.addEventListener('keydown', (event) => {
    const block = event.target instanceof Element ? event.target.closest('.block') : null;
    if (block === null || !(event.key === 'ArrowLeft' || event.key === 'ArrowRight') || !(event.shiftKey || event.altKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.key === 'ArrowRight') !== rtl() ? NUDGE : -NUDGE;
    const part = event.shiftKey && event.altKey ? 'body' : event.shiftKey ? 'start' : 'end';
    onEditStart();
    if (block.classList.contains('block--clip')) {
      const index = [...clipsTrack.children].indexOf(block);
      const clip = model.clips[index];
      const previous = model.clips[index - 1];
      const next = model.clips[index + 1];
      if (clip !== undefined && part !== 'body') {
        onEdit((draft) => {
          if (part === 'start') draft.clips[index].start = Math.min(clip.end - MIN_CLIP, Math.max(previous?.end ?? 0, clip.start + step));
          else draft.clips[index].end = Math.max(clip.start + MIN_CLIP, Math.min(next?.start ?? duration, clip.end + step));
        });
      }
    } else {
      const id = block.dataset.id;
      const zoom = model.zooms.find((entry) => entry.id === id);
      if (zoom !== undefined) {
        const others = model.zooms.filter((entry) => entry.id !== id);
        const before = Math.max(0, ...others.filter((entry) => entry.start < zoom.start).map((entry) => entry.end));
        const after = Math.min(duration, ...others.filter((entry) => entry.start >= zoom.start).map((entry) => entry.start));
        const length = zoom.end - zoom.start;
        onEdit((draft) => {
          const target = draft.zooms.find((entry) => entry.id === id);
          if (target === undefined) return;
          if (part === 'start') target.start = Math.min(zoom.end - MIN_ZOOM_LENGTH, Math.max(before, zoom.start + step));
          else if (part === 'end') target.end = Math.max(zoom.start + MIN_ZOOM_LENGTH, Math.min(after, zoom.end + step));
          else {
            target.start = Math.min(after - length, Math.max(before, zoom.start + step));
            target.end = target.start + length;
          }
          target.focusAt = Math.min(target.end, Math.max(target.start, zoom.focusAt + (target.start - zoom.start)));
          target.edited = true;
        });
      }
    }
    onEditEnd();
    block.focus();
  });

  // Blocks are updated in place so a block being dragged keeps its pointer.
  function render(next) {
    model = { ...model, ...next };
    if (clipsTrack.children.length !== model.clips.length) {
      clipsTrack.replaceChildren(...model.clips.map((_, index) => clipBlock(index)));
    }
    Array.from(clipsTrack.children).forEach((block, index) => updateClip(block, index));
    const ids = model.zooms.map((zoom) => zoom.id).join(' ');
    if (Array.from(zoomsTrack.children).map((block) => block.dataset.id).join(' ') !== ids) {
      zoomsTrack.replaceChildren(...model.zooms.map((zoom) => zoomBlock(zoom.id)));
    }
    Array.from(zoomsTrack.children).forEach((block, index) => updateZoom(block, model.zooms[index]));
  }

  function setPlayhead(sourceTime) {
    playhead.style.insetInlineStart = percent(sourceTime);
  }

  for (const track of [clipsTrack, zoomsTrack, ruler]) {
    track.addEventListener('pointerdown', (event) => {
      if (event.target !== track) return;
      event.preventDefault();
      onSelect(null);
      track.setPointerCapture(event.pointerId);
      onSeek(timeAt(event.clientX));
      const move = (next) => onSeek(timeAt(next.clientX));
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
  }

  buildRuler();
  return { render, setPlayhead, rebuildRuler: buildRuler };
}
