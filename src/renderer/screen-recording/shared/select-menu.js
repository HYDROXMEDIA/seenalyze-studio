// In-app option lists for every single-choice <select> on a page. Chromium
// opens a system menu for <select> (an AppKit menu on macOS, a Win32 list on
// Windows); this draws the list in the page instead so it looks the same as
// the rest of the app everywhere. The <select> stays the source of truth:
// its options, value, disabled state and input/change events are unchanged,
// so page code keeps reading and writing it as before.

import './select-menu.css';

/** Keys that open the list on a focused <select>, as the system list does. */
const OPEN_KEYS = new Set([' ', 'ArrowDown', 'ArrowUp', 'F4']);
const TYPEAHEAD_RESET_MS = 700;
const VIEWPORT_MARGIN = 8;
const GAP = 4;

/** @type {{ select: HTMLSelectElement, popup: HTMLElement, rows: HTMLElement[], index: number, typed: string, typedAt: number, observer: MutationObserver } | null} */
let open = null;
let installed = false;
let nextId = 0;

/** @param {EventTarget | null} target */
function selectFrom(target) {
  const select = target instanceof Element ? target.closest('select') : null;
  if (!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1) return null;
  return select;
}

/**
 * The <select>'s label text without its own option texts (a wrapping <label>
 * contains the <select> itself). @param {HTMLSelectElement} select
 */
function accessibleName(select) {
  const own = select.getAttribute('aria-label');
  if (own) return own;
  const label = select.labels?.[0];
  if (!label) return '';
  let text = '';
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!select.contains(node)) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** @param {number} index */
function enabled(index) {
  const option = open?.select.options[index];
  return Boolean(option && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled));
}

/** @param {number} index */
function highlight(index) {
  if (!open) return;
  open.index = index;
  for (const [position, row] of open.rows.entries()) {
    const active = position === index;
    row.classList.toggle('is-active', active);
    if (active) {
      open.popup.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** @param {number} from @param {1 | -1} step */
function step(from, step) {
  if (!open) return from;
  for (let index = from + step; index >= 0 && index < open.rows.length; index += step) {
    if (enabled(index)) return index;
  }
  return from;
}

function place() {
  if (!open) return;
  const { select, popup } = open;
  const anchor = select.getBoundingClientRect();
  popup.style.minWidth = `${Math.round(anchor.width)}px`;
  popup.style.maxHeight = '';
  const below = window.innerHeight - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const above = anchor.top - GAP - VIEWPORT_MARGIN;
  const natural = popup.scrollHeight;
  const downward = natural <= below || below >= above;
  const room = Math.max(0, downward ? below : above);
  popup.style.maxHeight = `${Math.floor(room)}px`;
  const height = Math.min(natural, room);
  const width = popup.offsetWidth;
  const left = Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN));
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(downward ? anchor.bottom + GAP : anchor.top - GAP - height)}px`;
  popup.dataset.side = downward ? 'bottom' : 'top';
}

/** @param {{ restoreFocus?: boolean }} [options] */
function close({ restoreFocus = true } = {}) {
  if (!open) return;
  const { select, popup, observer } = open;
  open = null;
  observer.disconnect();
  popup.remove();
  select.removeAttribute('aria-expanded');
  select.removeAttribute('aria-controls');
  if (restoreFocus && select.isConnected) select.focus({ preventScroll: true });
}

/** @param {number} index */
function choose(index) {
  if (!open || !enabled(index)) return;
  const { select } = open;
  close();
  if (select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** @param {HTMLSelectElement} select */
function show(select) {
  close({ restoreFocus: false });
  if (select.disabled || select.options.length === 0) return;
  const popup = document.createElement('div');
  popup.className = 'select-menu';
  popup.id = `select-menu-${++nextId}`;
  popup.setAttribute('role', 'listbox');
  const label = accessibleName(select);
  if (label) popup.setAttribute('aria-label', label);

  /** @type {HTMLElement[]} */
  const rows = [];
  /** @type {HTMLOptGroupElement | null} */
  let group = null;
  for (const [index, option] of Array.from(select.options).entries()) {
    const parent = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
    if (parent !== group) {
      group = parent;
      if (group?.label) {
        const heading = document.createElement('div');
        heading.className = 'select-menu-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group.label;
        popup.append(heading);
      }
    }
    const row = document.createElement('div');
    row.className = 'select-menu-option';
    row.id = `${popup.id}-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === select.selectedIndex));
    row.textContent = option.label || option.textContent || '';
    if (option.disabled || group?.disabled) row.setAttribute('aria-disabled', 'true');
    row.addEventListener('pointermove', () => {
      if (open && open.index !== index && enabled(index)) highlight(index);
    });
    row.addEventListener('click', () => choose(index));
    rows.push(row);
    popup.append(row);
  }

  // Keep presses inside the list away from page handlers (such as drawing a
  // capture area); the list itself never takes focus from the <select>.
  popup.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  popup.addEventListener('mousedown', (event) => event.preventDefault());

  // Inside an open <dialog> (anything else is inert behind a modal one), and
  // in the top layer so no stacking, transform or blur of a parent clips or
  // moves it.
  popup.popover = 'manual';
  (select.closest('dialog') ?? document.body).append(popup);
  popup.showPopover();
  // The page may refill or disable the <select> while the list is open (for
  // example when a device list arrives); the list follows.
  const observer = new MutationObserver(() => {
    if (open?.select !== select) return;
    if (select.disabled || !select.isConnected) close({ restoreFocus: false });
    else show(select);
  });
  observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label'] });
  open = { select, popup, rows, index: select.selectedIndex, typed: '', typedAt: 0, observer };
  select.setAttribute('aria-expanded', 'true');
  select.setAttribute('aria-controls', popup.id);
  place();
  highlight(enabled(select.selectedIndex) ? select.selectedIndex : step(-1, 1));
}

/** Jumps to the next option starting with the typed letters, like the system list. @param {string} key */
function typeahead(key) {
  if (!open) return;
  const now = performance.now();
  open.typed = now - open.typedAt > TYPEAHEAD_RESET_MS ? key : open.typed + key;
  open.typedAt = now;
  const query = open.typed.toLocaleLowerCase();
  const count = open.rows.length;
  const start = open.typed.length === 1 ? open.index + 1 : open.index;
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    if (enabled(index) && (open.rows[index].textContent ?? '').toLocaleLowerCase().startsWith(query)) {
      highlight(index);
      return;
    }
  }
}

/**
 * A press outside an open list only dismisses it, as with the system list:
 * the rest of that press (mousedown, click) is kept from the page.
 */
let dismissing = false;

/** @param {Event} event */
function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** @param {PointerEvent} event */
function onPointerDown(event) {
  dismissing = false;
  if (!open || (event.target instanceof Node && open.popup.contains(event.target))) return;
  const same = selectFrom(event.target) === open.select;
  dismissing = true;
  swallow(event);
  close({ restoreFocus: same });
}

/** @param {MouseEvent} event */
function onMouseDown(event) {
  if (dismissing) return swallow(event);
  if (event.button !== 0 || open) return;
  const select = selectFrom(event.target);
  if (!select || select.disabled) return;
  // Stops Chromium from opening its own list.
  event.preventDefault();
  select.focus({ preventScroll: true });
  show(select);
}

/** @param {MouseEvent} event */
function onClick(event) {
  if (!dismissing) return;
  dismissing = false;
  swallow(event);
}

/** @param {KeyboardEvent} event */
function onKeyDown(event) {
  if (!open) {
    const select = selectFrom(event.target);
    if (!select || select.disabled || event.metaKey || event.ctrlKey) return;
    if (!OPEN_KEYS.has(event.key)) return;
    swallow(event);
    show(select);
    return;
  }
  const consume = () => swallow(event);
  switch (event.key) {
    case 'ArrowDown':
      consume();
      highlight(step(open.index, 1));
      return;
    case 'ArrowUp':
      consume();
      if (event.altKey) choose(open.index);
      else highlight(step(open.index, -1));
      return;
    case 'Home':
      consume();
      highlight(step(-1, 1));
      return;
    case 'End':
      consume();
      highlight(step(open.rows.length, -1));
      return;
    case 'PageDown':
    case 'PageUp': {
      consume();
      const direction = event.key === 'PageDown' ? 1 : -1;
      let index = open.index;
      for (let count = 0; count < 8; count += 1) index = step(index, direction);
      highlight(index);
      return;
    }
    case 'Enter':
    case ' ':
      consume();
      if (event.key === ' ' && open.typed && performance.now() - open.typedAt < TYPEAHEAD_RESET_MS) typeahead(' ');
      else choose(open.index);
      return;
    case 'Escape':
    case 'F4':
      consume();
      close();
      return;
    case 'Tab':
      close();
      return;
    default:
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        consume();
        typeahead(event.key);
      }
  }
}

/** @param {Event} event */
function onScroll(event) {
  if (open && !(event.target instanceof Node && open.popup.contains(event.target))) close({ restoreFocus: false });
}

/**
 * Replaces the system list of every single-choice <select> in this window
 * (present now or added later) with an in-page list. Call it before the page
 * adds its own key handlers. Safe to call more than once.
 */
export function installSelectMenus() {
  if (installed) return;
  installed = true;
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  // On the window, capture phase: runs before page shortcuts when installed
  // first, so keys meant for an open list never reach them.
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', () => close({ restoreFocus: false }));
  window.addEventListener('blur', () => close({ restoreFocus: false }));
}
