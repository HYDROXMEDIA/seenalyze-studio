// Small builders so presets declare their editable settings consistently.

import { FONT_CHOICES, type OverlayField, type OverlayFieldGroup } from "../../../shared/overlays";

type Extra = Partial<Omit<OverlayField, "key" | "label" | "type" | "default">>;

export const color = (key: string, label: string, value: string, group: OverlayFieldGroup = "Colors"): OverlayField => ({
  key,
  label,
  type: "color",
  default: value,
  group,
});

export const range = (key: string, label: string, value: number, min: number, max: number, extra: Extra = {}): OverlayField => ({
  key,
  label,
  type: "range",
  default: value,
  min,
  max,
  step: extra.step ?? 1,
  group: extra.group ?? "Layout",
  ...extra,
});

export const toggle = (key: string, label: string, value: boolean, group: OverlayFieldGroup = "Content"): OverlayField => ({
  key,
  label,
  type: "toggle",
  default: value,
  group,
});

export const text = (key: string, label: string, value: string, group: OverlayFieldGroup = "Content"): OverlayField => ({
  key,
  label,
  type: "text",
  default: value,
  group,
});

export const textarea = (key: string, label: string, value: string, group: OverlayFieldGroup = "Content"): OverlayField => ({
  key,
  label,
  type: "textarea",
  default: value,
  group,
});

export const select = (key: string, label: string, value: string, options: [string, string][], group: OverlayFieldGroup = "Layout"): OverlayField => ({
  key,
  label,
  type: "select",
  default: value,
  options: options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel })),
  group,
});

export const font = (key = "font", label = "Font", value = "system"): OverlayField => ({
  key,
  label,
  type: "font",
  default: value,
  options: FONT_CHOICES,
  group: "Typography",
});

/** Shared animation settings: entrance style, duration and easing. */
export const animationFields = (defaults: { enter?: string; duration?: number; easing?: string } = {}): OverlayField[] => [
  select(
    "enter",
    "Entrance",
    defaults.enter ?? "slide-up",
    [
      ["slide-up", "Slide up"],
      ["slide-left", "Slide from left"],
      ["slide-right", "Slide from right"],
      ["pop", "Pop"],
      ["fade", "Fade"],
      ["flip", "Flip"],
      ["blur", "Blur in"],
      ["none", "None"],
    ],
    "Animation",
  ),
  range("duration", "Animation speed", defaults.duration ?? 450, 0, 2000, { step: 50, unit: "ms", group: "Animation" }),
  select(
    "easing",
    "Easing",
    defaults.easing ?? "spring",
    [
      ["spring", "Spring"],
      ["smooth", "Smooth"],
      ["snappy", "Snappy"],
      ["linear", "Linear"],
    ],
    "Animation",
  ),
];

/**
 * CSS for the shared animation settings. Elements get `class="sz-in"` and the
 * entrance is chosen via `data-enter` on <body> (kept in sync by enterScript).
 */
export const ANIMATION_CSS = `
:root{--sz-ease:cubic-bezier(.2,.9,.25,1.15)}
body[data-easing="smooth"]{--sz-ease:cubic-bezier(.22,1,.36,1)}
body[data-easing="snappy"]{--sz-ease:cubic-bezier(.5,0,.1,1)}
body[data-easing="linear"]{--sz-ease:linear}
.sz-in{animation:var(--sz-anim,sz-slide-up) var(--s-duration,450ms) var(--sz-ease) both}
body[data-enter="slide-up"]{--sz-anim:sz-slide-up}
body[data-enter="slide-left"]{--sz-anim:sz-slide-left}
body[data-enter="slide-right"]{--sz-anim:sz-slide-right}
body[data-enter="pop"]{--sz-anim:sz-pop}
body[data-enter="fade"]{--sz-anim:sz-fade}
body[data-enter="flip"]{--sz-anim:sz-flip}
body[data-enter="blur"]{--sz-anim:sz-blur}
body[data-enter="none"] .sz-in{animation:none}
.sz-out{animation:sz-out calc(var(--s-duration,450ms) * .8) ease-in both}
@keyframes sz-slide-up{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}
@keyframes sz-slide-left{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}
@keyframes sz-slide-right{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
@keyframes sz-pop{0%{opacity:0;transform:scale(.6)}70%{opacity:1;transform:scale(1.04)}100%{transform:none}}
@keyframes sz-fade{from{opacity:0}to{opacity:1}}
@keyframes sz-flip{from{opacity:0;transform:perspective(600px) rotateX(-70deg)}to{opacity:1;transform:none}}
@keyframes sz-blur{from{opacity:0;filter:blur(12px);transform:scale(1.04)}to{opacity:1;filter:none;transform:none}}
@keyframes sz-out{to{opacity:0;transform:translateY(-12px) scale(.98)}}
`;

/** Keeps body data attributes in sync with the animation settings. */
export const ANIMATION_SCRIPT = `
(() => {
  const sync = (s) => { document.body.dataset.enter = s.enter || "slide-up"; document.body.dataset.easing = s.easing || "spring"; };
  sync(SEENALYZE.settings);
  SEENALYZE.onSettings(sync);
})();
`;
