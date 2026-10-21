// Keeps keyboard focus in the editor when the focused control is disabled or
// removed by an edit: Undo and Redo, Delete, and timeline blocks that a split,
// delete or undo rebuilds. Without this, focus falls back to the page and the
// next Tab starts over from the top.

// The nearest usable entry to `index`, looking forward first; -1 when none is.
export function nearestUsable(usable, index) {
  const last = usable.length - 1;
  const from = Math.min(Math.max(index, 0), last);
  for (let distance = 0; distance <= last; distance += 1) {
    if (usable[from + distance]) return from + distance;
    if (distance > 0 && usable[from - distance]) return from - distance;
  }
  return -1;
}

const GROUPS = '.toolbar, .tools, [data-track]';

// Where focus is before a render, when it is on a control a render can disable or remove.
export function focusPosition() {
  const element = document.activeElement;
  const group = element instanceof HTMLButtonElement ? element.closest(GROUPS) : null;
  if (group === null) return null;
  return { element, group, index: [...group.querySelectorAll('button')].indexOf(element) };
}

// After a render: when that control is gone or disabled and focus fell to the
// page, focus the selected block of its track, or the nearest usable control
// of its group, or else the first timeline block.
export function restoreFocus(position, fallbackRoot) {
  if (position === null) return;
  const { element, group, index } = position;
  if (element.isConnected && !element.disabled) return;
  const active = document.activeElement;
  if (active !== null && active !== document.body && active !== element) return;
  const buttons = [...group.querySelectorAll('button')];
  const usable = buttons.map((button) => !button.disabled && button.getClientRects().length > 0);
  const selected = group.hasAttribute('data-track') ? group.querySelector('button[aria-pressed="true"]') : null;
  const nearest = nearestUsable(usable, index);
  const target = selected ?? (nearest >= 0 ? buttons[nearest] : fallbackRoot.querySelector('[data-track] button'));
  target?.focus();
}
