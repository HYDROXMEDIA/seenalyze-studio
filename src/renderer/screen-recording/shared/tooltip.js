// Tooltips for controls without a visible text label in the screen-recording
// windows, matching the studio's tooltips: a short delay on hover, instant
// while moving between neighbouring controls, and shown on keyboard focus.
// Mark a control with `data-tooltip` (static markup translates it through
// a `data-tooltip:<key>` pair in `data-i18n-attr`); its accessible name stays on
// `aria-label`.

import './tooltip.css';

const SHOW_DELAY_MS = 350;
/** Within this time after one tooltip hides, the next one shows at once. */
const SKIP_DELAY_MS = 300;
const GAP = 6;
const VIEWPORT_MARGIN = 8;

let installed = false;

/** @param {EventTarget | null} target @returns {HTMLElement | null} */
function controlFrom(target) {
  const element = target instanceof Element ? target.closest('[data-tooltip]') : null;
  return element instanceof HTMLElement ? element : null;
}

/** @param {HTMLElement} control */
function unavailable(control) {
  return (control instanceof HTMLButtonElement && control.disabled) || control.getAttribute('aria-expanded') === 'true' || !control.dataset.tooltip;
}

export function installTooltips() {
  if (installed) return;
  installed = true;

  const tip = document.createElement('div');
  tip.className = 'sr-tooltip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.append(tip);

  /** @type {HTMLElement | null} */
  let current = null;
  let timer = 0;
  let hiddenAt = 0;

  /** @param {HTMLElement} control */
  const place = (control) => {
    const anchor = control.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const fitsBelow = below + box.height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, anchor.top - GAP - box.height);
    const centered = anchor.left + anchor.width / 2 - box.width / 2;
    const left = Math.min(Math.max(VIEWPORT_MARGIN, centered), window.innerWidth - VIEWPORT_MARGIN - box.width);
    tip.dataset.side = fitsBelow ? 'bottom' : 'top';
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  /** @param {HTMLElement} control */
  const show = (control) => {
    window.clearTimeout(timer);
    if (!control.isConnected || unavailable(control)) return;
    current = control;
    tip.textContent = control.dataset.tooltip ?? '';
    // Measure unscaled, then restart the entrance animation for this control.
    tip.classList.remove('is-visible');
    tip.hidden = false;
    place(control);
    void tip.offsetWidth;
    tip.classList.add('is-visible');
  };

  const hide = () => {
    window.clearTimeout(timer);
    if (current === null && tip.hidden) return;
    if (!tip.hidden) hiddenAt = performance.now();
    current = null;
    tip.hidden = true;
    tip.classList.remove('is-visible');
  };

  /** @param {HTMLElement} control @param {boolean} immediate */
  const schedule = (control, immediate) => {
    window.clearTimeout(timer);
    current = control;
    if (immediate || performance.now() - hiddenAt < SKIP_DELAY_MS) show(control);
    else timer = window.setTimeout(() => show(control), SHOW_DELAY_MS);
  };

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const control = controlFrom(event.target);
    if (control === current) return;
    if (current !== null) hide();
    if (control !== null && !unavailable(control)) schedule(control, false);
  });
  document.addEventListener('pointerout', (event) => {
    if (current === null) return;
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (next === null || !current.contains(next)) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (event) => {
    const control = controlFrom(event.target);
    // Only keyboard focus: focus returning after a click or a closed menu stays quiet.
    if (control !== null && control.matches(':focus-visible') && !unavailable(control)) schedule(control, true);
  });
  document.addEventListener('focusout', (event) => {
    if (controlFrom(event.target) === current) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tip.hidden) hide();
  });
  // The control moved or changed under the tooltip; it is stale.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}
