import type { OverlayPreset } from "../../../shared/overlays";
import { ANIMATION_CSS, ANIMATION_SCRIPT, animationFields, color, font, range, select, text, toggle } from "./fields";

const GOAL_METRICS: [string, string][] = [
  ["sessionFollows", "New followers this stream"],
  ["sessionSubs", "New subs and members this stream"],
  ["sessionBits", "Bits this stream"],
  ["followers", "Total followers"],
  ["subscribers", "Total subscribers"],
  ["viewers", "Current viewers"],
];

/** Reads a goal metric from the stats object. */
const METRIC_JS = `
const metricValue = (stats, metric) => metric === "viewers" ? (stats.viewers ? stats.viewers.total : 0) : Number(stats[metric] || 0);
`;

export const WIDGET_PRESETS: OverlayPreset[] = [
  {
    id: "goal-bar",
    name: "Goal bar",
    kind: "goal",
    description: "Animated progress bar toward a follower, sub or bits goal.",
    accent: "#34d399",
    width: 760,
    height: 120,
    fields: [
      text("title", "Goal title", "Follower goal"),
      select("metric", "Track", "sessionFollows", GOAL_METRICS, "Content"),
      range("target", "Goal", 50, 1, 100000, { group: "Content" }),
      toggle("showNumbers", "Show numbers", true),
      toggle("celebrate", "Celebrate when reached", true, "Behavior"),
      color("trackColor", "Track", "rgba(255,255,255,0.14)"),
      color("fillFrom", "Fill start", "#34d399"),
      color("fillTo", "Fill end", "#22d3ee"),
      color("textColor", "Text", "#ffffff"),
      color("panelColor", "Panel", "rgba(10,12,16,0.7)"),
      range("height", "Bar height", 22, 6, 60, { unit: "px" }),
      range("radius", "Corner radius", 999, 0, 999, { unit: "px" }),
      font(),
      range("fontSize", "Text size", 20, 10, 48, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "fade", duration: 900, easing: "smooth" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.goal{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:.45em;padding:.7em 1em;box-sizing:border-box;background:var(--s-panelColor);border-radius:18px}
.head{display:flex;justify-content:space-between;font-weight:800}
.nums{font-variant-numeric:tabular-nums;opacity:.9}
.track{height:var(--s-height);border-radius:var(--s-radius);background:var(--s-trackColor);overflow:hidden}
.fill{height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,var(--s-fillFrom),var(--s-fillTo));transition:width var(--s-duration) var(--sz-ease);position:relative}
.fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:sheen 2.4s linear infinite}
.done .fill{animation:pulse 1.2s ease-in-out 3}
@keyframes sheen{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@keyframes pulse{50%{filter:brightness(1.35)}}
</style>
<div class="goal sz-in"><div class="head"><span id="title"></span><span class="nums" id="nums"></span></div><div class="track"><div class="fill" id="fill"></div></div></div>
<script>${ANIMATION_SCRIPT}${METRIC_JS}
(() => {
  const S = SEENALYZE;
  let stats = null, reached = false;
  const render = () => {
    document.getElementById("title").textContent = S.settings.title;
    const target = Math.max(1, Number(S.settings.target) || 1);
    const value = stats ? metricValue(stats, S.settings.metric) : 0;
    const pct = Math.min(100, (value / target) * 100);
    document.getElementById("fill").style.width = pct + "%";
    document.getElementById("nums").textContent = S.settings.showNumbers ? S.formatNumber(value) + " / " + S.formatNumber(target) : "";
    const goal = document.querySelector(".goal");
    if (pct >= 100 && !reached && S.settings.celebrate) { goal.classList.remove("done"); void goal.offsetWidth; goal.classList.add("done"); }
    reached = pct >= 100;
  };
  S.onStats((next) => { stats = next; render(); });
  S.onSettings(render);
  render();
})();
</script>`,
  },
  {
    id: "goal-ring",
    name: "Goal ring",
    kind: "goal",
    description: "Circular progress ring with the count in the middle.",
    accent: "#a78bfa",
    width: 260,
    height: 260,
    fields: [
      text("title", "Label", "Subs"),
      select("metric", "Track", "sessionSubs", GOAL_METRICS, "Content"),
      range("target", "Goal", 25, 1, 100000, { group: "Content" }),
      color("ringColor", "Ring", "#a78bfa"),
      color("trackColor", "Track", "rgba(255,255,255,0.15)"),
      color("textColor", "Text", "#ffffff"),
      color("centerColor", "Center", "rgba(10,10,14,0.72)"),
      range("thickness", "Ring thickness", 14, 4, 40),
      font(),
      ...animationFields({ enter: "pop", duration: 900, easing: "smooth" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);color:var(--s-textColor)}
.wrap{position:absolute;inset:8px;display:grid;place-items:center}
svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
circle{fill:none;stroke-width:var(--s-thickness)}
.track{stroke:var(--s-trackColor)}
.bar{stroke:var(--s-ringColor);stroke-linecap:round;transition:stroke-dashoffset var(--s-duration) var(--sz-ease);filter:drop-shadow(0 0 8px var(--s-ringColor))}
.center{position:relative;width:72%;height:72%;border-radius:50%;background:var(--s-centerColor);display:grid;place-items:center;text-align:center}
.value{font-size:44px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1}
.label{font-size:15px;opacity:.8;margin-top:4px}
</style>
<div class="wrap sz-in"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="bar" id="bar" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
<div class="center"><div><div class="value" id="value">0</div><div class="label" id="label"></div></div></div></div>
<script>${ANIMATION_SCRIPT}${METRIC_JS}
(() => {
  const S = SEENALYZE;
  let stats = null;
  const render = () => {
    const target = Math.max(1, Number(S.settings.target) || 1);
    const value = stats ? metricValue(stats, S.settings.metric) : 0;
    document.getElementById("bar").style.strokeDashoffset = String(100 - Math.min(100, (value / target) * 100));
    document.getElementById("value").textContent = S.formatNumber(value);
    document.getElementById("label").textContent = S.settings.title + " · " + S.formatNumber(target);
  };
  S.onStats((next) => { stats = next; render(); });
  S.onSettings(render);
  render();
})();
</script>`,
  },
  {
    id: "events-recent",
    name: "Recent events",
    kind: "eventList",
    description: "Stack of the latest follows, subs, Super Chats and raids.",
    accent: "#fb923c",
    width: 420,
    height: 380,
    fields: [
      range("maxItems", "Items shown", 5, 1, 15, { group: "Behavior" }),
      toggle("showLogos", "Platform logos", true),
      toggle("showFollows", "Include follows", true),
      color("rowColor", "Row", "rgba(12,12,16,0.7)"),
      color("textColor", "Text", "#ffffff"),
      color("accentColor", "Accent", "#fb923c"),
      range("radius", "Corner radius", 12, 0, 30, { unit: "px" }),
      font(),
      range("fontSize", "Text size", 17, 10, 40, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "slide-right" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
#list{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:10px;box-sizing:border-box}
.item{display:flex;align-items:center;gap:.6em;padding:.5em .8em;border-radius:var(--s-radius);background:var(--s-rowColor);border-left:3px solid var(--s-accentColor)}
.logo{flex:none;width:1.1em;height:1.1em}.logo svg{width:100%;height:100%}
.who{font-weight:800}.what{opacity:.8;margin-left:auto;white-space:nowrap;font-size:.85em}
</style><div id="list"></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  const list = document.getElementById("list");
  const describe = (e) => ({ follow: "followed", subscription: "subscribed", resub: (e.months || "") + " mo resub", giftSub: "gifted " + (e.count || 1),
    cheer: e.amountLabel || "cheered", raid: "raid · " + (e.count || 0), superChat: e.amountLabel || "Super Chat", superSticker: e.amountLabel || "Super Sticker",
    membership: "new member", memberMilestone: (e.months || "") + " mo member", giftMembership: "gifted " + (e.count || 1), redemption: "redeemed" })[e.type] || e.type;
  S.onEvent((e) => {
    if (e.type === "follow" && !S.settings.showFollows) return;
    const item = document.createElement("div");
    item.className = "item sz-in";
    if (S.settings.showLogos) { const logo = document.createElement("span"); logo.className = "logo"; logo.innerHTML = S.platformLogo(e.platform); item.append(logo); }
    const who = document.createElement("span"); who.className = "who"; who.textContent = e.userName;
    const what = document.createElement("span"); what.className = "what"; what.textContent = describe(e);
    item.append(who, what);
    list.prepend(item);
    while (list.children.length > Number(S.settings.maxItems || 5)) list.lastElementChild.remove();
  });
})();
</script>`,
  },
  {
    id: "events-supporters",
    name: "Top supporters",
    kind: "eventList",
    description: "Leaderboard of this stream's biggest supporters across platforms.",
    accent: "#fde047",
    width: 380,
    height: 320,
    fields: [
      text("title", "Title", "Top supporters"),
      range("maxItems", "Places", 3, 1, 10, { group: "Behavior" }),
      color("panelColor", "Panel", "rgba(10,10,14,0.75)"),
      color("textColor", "Text", "#ffffff"),
      color("goldColor", "First place", "#fde047"),
      font(),
      range("fontSize", "Text size", 18, 10, 40, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "fade" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.panel{position:absolute;inset:0;padding:.9em 1em;box-sizing:border-box;background:var(--s-panelColor);border-radius:18px}
h1{margin:0 0 .5em;font-size:1em;font-weight:900}
.row{display:flex;align-items:center;gap:.6em;padding:.35em 0;transition:transform .4s var(--sz-ease)}
.place{width:1.6em;height:1.6em;border-radius:50%;display:grid;place-items:center;font-weight:900;background:rgba(255,255,255,.12)}
.row:first-of-type .place{background:var(--s-goldColor);color:#111}
.logo{width:1em;height:1em}.logo svg{width:100%;height:100%}
.score{margin-left:auto;font-variant-numeric:tabular-nums;opacity:.85}
</style><div class="panel sz-in"><h1 id="title"></h1><div id="rows"></div></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  // Support is normalised to points so platforms compare fairly: $1 = 100 bits = 100 points.
  const points = (e) => e.type === "cheer" ? (e.amount || 0) : e.type === "superChat" || e.type === "superSticker" ? (e.amount || 0) * 100
    : e.type === "giftSub" || e.type === "giftMembership" ? (e.count || 1) * 500 : e.type === "subscription" || e.type === "resub" || e.type === "membership" ? 500 : 0;
  const totals = new Map();
  const render = () => {
    document.getElementById("title").textContent = S.settings.title;
    const rows = document.getElementById("rows");
    rows.replaceChildren();
    [...totals.values()].sort((a, b) => b.points - a.points).slice(0, Number(S.settings.maxItems || 3)).forEach((t, i) => {
      const row = document.createElement("div"); row.className = "row";
      const place = document.createElement("span"); place.className = "place"; place.textContent = String(i + 1);
      const logo = document.createElement("span"); logo.className = "logo"; logo.innerHTML = S.platformLogo(t.platform);
      const name = document.createElement("span"); name.textContent = t.name;
      const score = document.createElement("span"); score.className = "score"; score.textContent = S.formatNumber(t.points);
      row.append(place, logo, name, score); rows.append(row);
    });
  };
  S.onEvent((e) => {
    const p = points(e);
    if (!p) return;
    const key = e.platform + ":" + e.userName;
    const current = totals.get(key) || { name: e.userName, platform: e.platform, points: 0 };
    current.points += p; totals.set(key, current); render();
  });
  S.onSettings(render);
  render();
})();
</script>`,
  },
  {
    id: "viewers-pill",
    name: "Live viewer counter",
    kind: "viewerCount",
    description: "Live dot with total viewers and a per-platform breakdown.",
    accent: "#f87171",
    width: 420,
    height: 90,
    fields: [
      toggle("showBreakdown", "Per-platform numbers", true),
      text("label", "Label", "watching"),
      color("pillColor", "Pill", "rgba(10,10,14,0.78)"),
      color("textColor", "Text", "#ffffff"),
      color("liveColor", "Live dot", "#ef4444"),
      font(),
      range("fontSize", "Text size", 22, 10, 48, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "pop" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.pill{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:.6em;padding:.45em .9em;border-radius:999px;background:var(--s-pillColor);font-variant-numeric:tabular-nums}
.dot{width:.6em;height:.6em;border-radius:50%;background:var(--s-liveColor);box-shadow:0 0 0 0 var(--s-liveColor);animation:ping 1.6s ease-out infinite}
.total{font-weight:900}.label{opacity:.8}
.part{display:flex;align-items:center;gap:.25em;opacity:.9;font-size:.85em}.part svg{width:1em;height:1em}
.bump{animation:bump .5s var(--sz-ease)}
@keyframes ping{70%{box-shadow:0 0 0 .5em transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes bump{40%{transform:scale(1.18)}}
</style><div class="pill sz-in"><span class="dot"></span><span class="total" id="total">0</span><span class="label" id="label"></span><span id="parts"></span></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  let last = null;
  const render = (stats) => {
    document.getElementById("label").textContent = S.settings.label;
    if (!stats) return;
    const total = document.getElementById("total");
    if (last !== null && stats.viewers.total !== last) { total.classList.remove("bump"); void total.offsetWidth; total.classList.add("bump"); }
    last = stats.viewers.total;
    total.textContent = S.formatNumber(stats.viewers.total);
    const parts = document.getElementById("parts");
    parts.replaceChildren();
    parts.style.display = S.settings.showBreakdown ? "flex" : "none";
    parts.style.gap = ".6em";
    for (const p of ["youtube", "twitch"]) {
      if (stats.viewers[p] == null) continue;
      const part = document.createElement("span"); part.className = "part";
      const logo = document.createElement("span"); logo.innerHTML = S.platformLogo(p);
      const n = document.createElement("span"); n.textContent = S.formatNumber(stats.viewers[p]);
      part.append(logo, n); parts.append(part);
    }
  };
  let stats = null;
  S.onStats((next) => { stats = next; render(next); });
  S.onSettings(() => render(stats));
  render(null);
})();
</script>`,
  },
  {
    id: "timer-uptime",
    name: "Stream uptime",
    kind: "timer",
    description: "How long you've been live, ticking every second.",
    accent: "#60a5fa",
    width: 320,
    height: 90,
    fields: [
      text("label", "Label", "LIVE"),
      toggle("showHours", "Always show hours", true),
      color("panelColor", "Panel", "rgba(10,10,14,0.75)"),
      color("textColor", "Text", "#ffffff"),
      color("labelColor", "Label", "#ef4444"),
      font("font", "Font", "mono"),
      range("fontSize", "Text size", 26, 12, 60, { unit: "px", group: "Typography" }),
      ...animationFields({ enter: "fade" }),
    ],
    html: `<style>${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize);color:var(--s-textColor)}
.box{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:.6em;padding:.35em .8em;border-radius:12px;background:var(--s-panelColor);font-variant-numeric:tabular-nums}
.label{font-weight:900;color:var(--s-labelColor);font-size:.7em}
</style><div class="box sz-in"><span class="label" id="label"></span><span id="time">0:00</span></div>
<script>${ANIMATION_SCRIPT}
(() => {
  const S = SEENALYZE;
  let base = 0, at = Date.now();
  const pad = (n) => String(n).padStart(2, "0");
  const tick = () => {
    const total = Math.max(0, Math.floor(base + (Date.now() - at) / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    document.getElementById("time").textContent = h > 0 || S.settings.showHours ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
    document.getElementById("label").textContent = S.settings.label;
  };
  S.onStats((stats) => { if (typeof stats.uptimeSeconds === "number") { base = stats.uptimeSeconds; at = Date.now(); } });
  S.onSettings(tick);
  setInterval(tick, 1000);
  tick();
})();
</script>`,
  },
];
