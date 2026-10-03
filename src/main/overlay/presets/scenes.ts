import type { OverlayField, OverlayPreset } from "../../../shared/overlays";
import { ANIMATION_CSS, ANIMATION_SCRIPT, animationFields, color, font, range, select, text, textarea, toggle } from "./fields";

/** Countdown that restarts whenever its minutes setting changes (or the page loads). */
const COUNTDOWN_JS = `
const startCountdown = (getMinutes, onTick) => {
  let end = Date.now() + getMinutes() * 60000, minutes = getMinutes();
  setInterval(() => {
    if (getMinutes() !== minutes) { minutes = getMinutes(); end = Date.now() + minutes * 60000; }
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    onTick(left);
  }, 250);
};
const formatClock = (left) => Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
`;

function screenFields(title: string, subtitle: string, from: string, to: string, withCountdown: boolean): OverlayField[] {
  return [
    text("title", "Title", title),
    text("subtitle", "Subtitle", subtitle),
    ...(withCountdown
      ? [range("minutes", "Countdown (minutes, 0 = off)", 5, 0, 120, { group: "Content" }), text("doneText", "When the countdown ends", "Starting now!")]
      : []),
    toggle("showChat", "Show live chat", true),
    toggle("showSocials", "Show socials line", true),
    text("socials", "Socials line", "@yourname everywhere"),
    select("background", "Background", "aurora", [
      ["aurora", "Moving aurora"],
      ["gradient", "Gradient"],
      ["transparent", "Transparent (use your own)"],
    ], "Colors"),
    color("from", "Color 1", from),
    color("to", "Color 2", to),
    color("textColor", "Text", "#ffffff"),
    font("font", "Font", "display"),
    range("titleSize", "Title size", 120, 40, 240, { unit: "px", group: "Typography" }),
    ...animationFields({ enter: "blur", duration: 900, easing: "smooth" }),
  ];
}

const SCREEN_CSS = `${ANIMATION_CSS}
body{font-family:var(--s-font);color:var(--s-textColor)}
.bg{position:absolute;inset:0;background:linear-gradient(135deg,var(--s-from),var(--s-to))}
body[data-bg="aurora"] .bg{background:radial-gradient(60% 80% at 20% 30%,var(--s-from),transparent 70%),radial-gradient(60% 80% at 80% 70%,var(--s-to),transparent 70%),#05060a;background-size:160% 160%;animation:drift 18s ease-in-out infinite alternate}
body[data-bg="transparent"] .bg{display:none}
@keyframes drift{from{background-position:0% 0%,100% 100%}to{background-position:100% 60%,0% 30%}}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:24px}
.title{font-size:var(--s-titleSize);font-weight:900;letter-spacing:-.02em;line-height:1;text-shadow:0 10px 40px rgba(0,0,0,.35)}
.subtitle{font-size:calc(var(--s-titleSize) * .3);opacity:.85}
.clock{font-size:calc(var(--s-titleSize) * .55);font-weight:800;font-variant-numeric:tabular-nums}
.socials{position:absolute;left:0;right:0;bottom:56px;text-align:center;font-size:30px;opacity:.85}
#chat{position:absolute;right:56px;bottom:120px;width:520px;display:flex;flex-direction:column;gap:10px}
.msg{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-radius:14px;background:rgba(0,0,0,.35);backdrop-filter:blur(8px);font-size:22px}
.msg svg{width:20px;height:20px;flex:none;margin-top:3px}.msg b{margin-right:6px}
`;

const SCREEN_JS = `${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  const sync = (s) => {
    document.body.dataset.bg = s.background;
    document.getElementById("title").textContent = s.title;
    document.getElementById("subtitle").textContent = s.subtitle;
    const socials = document.getElementById("socials");
    socials.textContent = s.socials; socials.style.display = s.showSocials ? "" : "none";
    document.getElementById("chat").style.display = s.showChat ? "" : "none";
  };
  sync(S.settings); S.onSettings(sync);
  const chat = document.getElementById("chat");
  S.onChat((m) => {
    const row = document.createElement("div"); row.className = "msg sz-in";
    const logo = document.createElement("span"); logo.innerHTML = S.platformLogo(m.platform);
    const body = document.createElement("span");
    const name = document.createElement("b"); name.textContent = m.authorName;
    body.append(name); S.renderSegments(body, m.segments);
    row.append(logo, body); chat.append(row);
    while (chat.children.length > 4) chat.firstElementChild.remove();
  });
})();
`;

const screenHtml = (withCountdown: boolean) => `<style>${SCREEN_CSS}</style>
<div class="bg"></div>
<div class="center"><div class="title sz-in" id="title"></div><div class="subtitle sz-in" id="subtitle"></div>${withCountdown ? `<div class="clock" id="clock"></div>` : ""}</div>
<div id="chat"></div><div class="socials" id="socials"></div>
<script>${SCREEN_JS}${
  withCountdown
    ? `${COUNTDOWN_JS}
startCountdown(() => Number(SEENALYZE.settings.minutes || 0), (left) => {
  const clock = document.getElementById("clock");
  if (Number(SEENALYZE.settings.minutes || 0) === 0) { clock.textContent = ""; return; }
  clock.textContent = left > 0 ? formatClock(left) : SEENALYZE.settings.doneText;
});`
    : ""
}</script>`;

export const SCENE_PRESETS: OverlayPreset[] = [
  {
    id: "scene-starting",
    name: "Starting soon",
    kind: "scene",
    description: "Full-screen intro with countdown, live chat and moving aurora.",
    accent: "#818cf8",
    width: 1920,
    height: 1080,
    fields: screenFields("Starting soon", "Grab a drink, we're about to go live", "#6366f1", "#ec4899", true),
    html: screenHtml(true),
  },
  {
    id: "scene-brb",
    name: "Be right back",
    kind: "scene",
    description: "Break screen that keeps chat visible while you're away.",
    accent: "#2dd4bf",
    width: 1920,
    height: 1080,
    fields: screenFields("Be right back", "Don't go anywhere", "#0d9488", "#2563eb", true).map((field) =>
      field.key === "minutes" ? { ...field, default: 0 } : field,
    ),
    html: screenHtml(true),
  },
  {
    id: "scene-ending",
    name: "Stream ending",
    kind: "scene",
    description: "Thank-you outro with socials and the last chat messages.",
    accent: "#f472b6",
    width: 1920,
    height: 1080,
    fields: screenFields("Thanks for watching!", "See you next stream", "#db2777", "#7c3aed", false),
    html: screenHtml(false),
  },
  {
    id: "label-lower-third",
    name: "Lower third",
    kind: "label",
    description: "Name and title card with an accent bar that wipes in.",
    accent: "#22d3ee",
    width: 900,
    height: 200,
    fields: [
      text("name", "Name", "Your Name"),
      text("role", "Title", "Streamer · Creator"),
      toggle("loop", "Hide and show again", false, "Behavior"),
      range("loopSeconds", "Repeat every", 30, 10, 300, { unit: "s", group: "Behavior" }),
      color("barColor", "Accent bar", "#22d3ee"),
      color("cardColor", "Card", "rgba(8,10,14,0.85)"),
      color("textColor", "Text", "#ffffff"),
      color("roleColor", "Title text", "#a5f3fc"),
      font(),
      range("fontSize", "Name size", 46, 20, 100, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "slide-left", duration: 700, easing: "smooth" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);color:var(--s-textColor)}
.wrap{position:absolute;left:10px;bottom:20px;display:flex;align-items:stretch}
.bar{width:10px;background:var(--s-barColor);border-radius:4px;transform-origin:bottom;animation:grow var(--s-duration) var(--sz-ease) both}
.card{padding:16px 28px;background:var(--s-cardColor);clip-path:inset(0 100% 0 0);animation:wipe var(--s-duration) var(--sz-ease) calc(var(--s-duration) * .4) both}
.name{font-size:var(--s-fontSize);font-weight:900;line-height:1.05}
.role{font-size:calc(var(--s-fontSize) * .5);color:var(--s-roleColor);margin-top:6px;font-weight:600}
.hidden .card{animation:unwipe calc(var(--s-duration) * .7) ease-in both}.hidden .bar{animation:shrink calc(var(--s-duration) * .7) ease-in calc(var(--s-duration) * .5) both}
@keyframes grow{from{transform:scaleY(0)}}@keyframes shrink{to{transform:scaleY(0)}}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}@keyframes unwipe{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 100% 0 0)}}
</style><div class="wrap" id="wrap"><div class="bar"></div><div class="card"><div class="name" id="name"></div><div class="role" id="role"></div></div></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  const wrap = document.getElementById("wrap");
  const sync = (s) => { document.getElementById("name").textContent = s.name; document.getElementById("role").textContent = s.role; };
  sync(S.settings); S.onSettings(sync);
  const replay = () => { wrap.classList.remove("hidden"); for (const el of wrap.children) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; } };
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!S.settings.loop) return;
    timer = setTimeout(() => { wrap.classList.add("hidden"); setTimeout(() => { replay(); schedule(); }, 4000); }, Number(S.settings.loopSeconds || 30) * 1000);
  };
  S.onSettings(schedule); schedule();
})();
</script>`,
  },
  {
    id: "ticker-socials",
    name: "Socials rotator",
    kind: "socials",
    description: "Cycles through your handles with a smooth flip.",
    accent: "#c084fc",
    width: 520,
    height: 90,
    fields: [
      textarea("handles", "Handles (one per line: Platform | handle)", "YouTube | @yourname\nTwitch | yourname\nX | @yourname\nInstagram | @yourname\nTikTok | @yourname"),
      range("seconds", "Seconds per handle", 5, 2, 30, { unit: "s", group: "Behavior" }),
      color("pillColor", "Pill", "rgba(10,10,14,0.8)"),
      color("textColor", "Text", "#ffffff"),
      color("accentColor", "Platform label", "#c084fc"),
      font(),
      range("fontSize", "Text size", 24, 12, 50, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "flip" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.pill{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:.6em;padding:.45em 1em;border-radius:999px;background:var(--s-pillColor);perspective:600px}
.icon{width:1.2em;height:1.2em;display:grid;place-items:center;font-weight:900;color:var(--s-accentColor)}.icon svg{width:100%;height:100%}
.platform{color:var(--s-accentColor);font-weight:800}.handle{font-weight:600}
</style><div class="pill" id="pill"></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  const pill = document.getElementById("pill");
  let index = 0;
  const entries = () => String(S.settings.handles || "").split("\\n").map((line) => line.split("|").map((part) => part.trim())).filter((parts) => parts[0] && parts[1]);
  const show = () => {
    const list = entries();
    if (!list.length) { pill.replaceChildren(); return; }
    const [platform, handle] = list[index % list.length];
    index += 1;
    const content = document.createElement("span"); content.className = "sz-in"; content.style.display = "flex"; content.style.alignItems = "center"; content.style.gap = ".6em";
    const icon = document.createElement("span"); icon.className = "icon";
    const key = platform.toLowerCase();
    const logo = key === "youtube" || key === "twitch" ? S.platformLogo(key) : "";
    if (logo) icon.innerHTML = logo; else icon.textContent = platform.slice(0, 1).toUpperCase();
    const name = document.createElement("span"); name.className = "platform"; name.textContent = platform;
    const value = document.createElement("span"); value.className = "handle"; value.textContent = handle;
    content.append(icon, name, value);
    pill.replaceChildren(content);
  };
  let timer = null;
  const loop = () => { clearTimeout(timer); show(); timer = setTimeout(loop, Number(S.settings.seconds || 5) * 1000); };
  S.onSettings(() => { index = Math.max(0, index - 1); loop(); });
  loop();
})();
</script>`,
  },
  {
    id: "ticker-announcement",
    name: "Scrolling ticker",
    kind: "ticker",
    description: "News-style band with an endlessly scrolling message.",
    accent: "#facc15",
    width: 1920,
    height: 70,
    fields: [
      text("badge", "Badge", "NEWS"),
      textarea("message", "Message", "Welcome to the stream! Follow for more · Drop your questions in chat · New videos every week"),
      range("speed", "Scroll speed", 90, 20, 300, { group: "Animation", unit: "px" }),
      color("bandColor", "Band", "rgba(8,8,12,0.85)"),
      color("badgeColor", "Badge", "#facc15"),
      color("textColor", "Text", "#ffffff"),
      font("font", "Font", "condensed"),
      range("fontSize", "Text size", 28, 14, 60, { unit: "px", group: "Typography" }),
    ],
    html: `<style>
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.band{position:absolute;inset:0;display:flex;align-items:center;background:var(--s-bandColor);overflow:hidden}
.badge{flex:none;align-self:stretch;display:grid;place-items:center;padding:0 1em;background:var(--s-badgeColor);color:#111;font-weight:900;z-index:1}
.track{display:flex;white-space:nowrap;will-change:transform}
.track span{padding-right:4em}
</style><div class="band"><div class="badge" id="badge"></div><div class="track" id="track"></div></div>
<script>
(() => {
  const S = SEENALYZE;
  const track = document.getElementById("track");
  let animation = null;
  const build = () => {
    document.getElementById("badge").textContent = S.settings.badge;
    track.replaceChildren();
    for (let i = 0; i < 2; i += 1) { const span = document.createElement("span"); span.textContent = S.settings.message; track.append(span); }
    const width = track.firstElementChild.getBoundingClientRect().width;
    if (animation) animation.cancel();
    animation = track.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + -width + "px)" }],
      { duration: (width / Math.max(10, Number(S.settings.speed) || 90)) * 1000, iterations: Infinity });
  };
  S.onSettings(build);
  build();
})();
</script>`,
  },
  {
    id: "countdown-simple",
    name: "Countdown",
    kind: "countdown",
    description: "Standalone countdown with a label and finish message.",
    accent: "#4ade80",
    width: 480,
    height: 180,
    fields: [
      text("label", "Label", "Giveaway in"),
      range("minutes", "Minutes", 10, 1, 240, { group: "Content" }),
      text("doneText", "Finish text", "Time's up!"),
      color("panelColor", "Panel", "rgba(10,10,14,0.78)"),
      color("textColor", "Text", "#ffffff"),
      color("accentColor", "Accent", "#4ade80"),
      font("font", "Font", "display"),
      range("fontSize", "Clock size", 64, 24, 160, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "pop" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);color:var(--s-textColor)}
.box{position:absolute;inset:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:22px;background:var(--s-panelColor)}
.label{font-size:calc(var(--s-fontSize) * .32);opacity:.85;font-weight:700}
.clock{font-size:var(--s-fontSize);font-weight:900;font-variant-numeric:tabular-nums;color:var(--s-accentColor)}
.done .clock{animation:pulse 1s ease-in-out infinite}@keyframes pulse{50%{transform:scale(1.06)}}
</style><div class="box sz-in" id="box"><div class="label" id="label"></div><div class="clock" id="clock"></div></div>
<script>${ANIMATION_SCRIPT}${COUNTDOWN_JS}
(() => {
  const S = SEENALYZE;
  S.onSettings(() => { document.getElementById("label").textContent = S.settings.label; });
  document.getElementById("label").textContent = S.settings.label;
  startCountdown(() => Number(S.settings.minutes || 1), (left) => {
    document.getElementById("clock").textContent = left > 0 ? formatClock(left) : S.settings.doneText;
    document.getElementById("box").classList.toggle("done", left === 0);
  });
})();
</script>`,
  },
];
