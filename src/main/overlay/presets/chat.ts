import type { OverlayField, OverlayPreset } from "../../../shared/overlays";
import { ANIMATION_CSS, ANIMATION_SCRIPT, animationFields, color, font, range, select, toggle } from "./fields";

/** Settings every chat style shares. */
function chatFields(overrides: { maxMessages?: number; fontSize?: number; hideAfter?: number; enter?: string } = {}): OverlayField[] {
  return [
    select("platforms", "Show chat from", "all", [
      ["all", "YouTube + Twitch"],
      ["youtube", "YouTube only"],
      ["twitch", "Twitch only"],
    ], "Content"),
    toggle("showLogos", "Platform logos", true),
    toggle("showAvatars", "Avatars", true),
    toggle("showBadges", "Badges", true),
    toggle("showHighlights", "Super Chats, subs and memberships", true),
    range("maxMessages", "Messages on screen", overrides.maxMessages ?? 8, 1, 30, { group: "Behavior" }),
    range("hideAfter", "Hide messages after (0 = never)", overrides.hideAfter ?? 0, 0, 300, { unit: "s", group: "Behavior" }),
    select("direction", "Newest message", "bottom", [
      ["bottom", "At the bottom"],
      ["top", "At the top"],
    ], "Layout"),
    range("gap", "Spacing", 8, 0, 40, { unit: "px" }),
    font(),
    range("fontSize", "Text size", overrides.fontSize ?? 18, 10, 48, { unit: "px", group: "Typography" }),
    range("nameWeight", "Name weight", 700, 400, 900, { step: 100, group: "Typography" }),
    ...animationFields({ enter: overrides.enter }),
  ];
}

/** Message engine shared by all chat styles (text is always inserted as text). */
const CHAT_SCRIPT = `
(() => {
  const S = SEENALYZE;
  const list = document.getElementById("chat");
  const rows = new Map();
  const badgeIcons = { owner: "★", moderator: "⚔", vip: "♦", member: "✦", subscriber: "✦", verified: "✓" };
  const palette = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#a3e635"];
  const colorFor = (m) => m.authorColor || palette[[...m.authorId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % palette.length];
  const allowed = (m) => S.settings.platforms === "all" || S.settings.platforms === m.platform;

  function remove(id, animate) {
    const row = rows.get(id);
    if (!row) return;
    rows.delete(id);
    if (!animate) { row.remove(); return; }
    row.classList.add("sz-out");
    row.addEventListener("animationend", () => row.remove(), { once: true });
  }

  function trim() {
    while (rows.size > Number(S.settings.maxMessages || 8)) remove(rows.keys().next().value, false);
  }

  function add(m) {
    if (!allowed(m) || rows.has(m.id)) return;
    if (m.highlight && !S.settings.showHighlights) return;
    const row = document.createElement("div");
    row.className = "row sz-in" + (m.highlight ? " hl hl-" + m.highlight.kind : "");
    row.dataset.platform = m.platform;
    if (S.settings.showAvatars) {
      const wrap = document.createElement("span");
      wrap.className = "avatar";
      if (typeof m.avatarUrl === "string" && m.avatarUrl.startsWith("https://")) {
        const img = document.createElement("img");
        img.src = m.avatarUrl;
        img.referrerPolicy = "no-referrer";
        wrap.append(img);
      } else {
        wrap.textContent = (m.authorName || "?").slice(0, 1).toUpperCase();
        wrap.style.background = colorFor(m);
      }
      if (S.settings.showLogos) {
        const logo = document.createElement("span");
        logo.className = "logo";
        logo.innerHTML = S.platformLogo(m.platform);
        wrap.append(logo);
      }
      row.append(wrap);
    } else if (S.settings.showLogos) {
      const logo = document.createElement("span");
      logo.className = "logo inline";
      logo.innerHTML = S.platformLogo(m.platform);
      row.append(logo);
    }
    const body = document.createElement("span");
    body.className = "body";
    if (m.highlight && m.highlight.label) {
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = m.highlight.label;
      body.append(label);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.style.setProperty("--name-color", colorFor(m));
    if (S.settings.showBadges) {
      for (const badge of m.badges || []) {
        const b = document.createElement("span");
        b.className = "badge badge-" + badge;
        b.textContent = badgeIcons[badge] || "";
        name.append(b);
      }
    }
    name.append(document.createTextNode(m.authorName || ""));
    const text = document.createElement("span");
    text.className = "text";
    S.renderSegments(text, m.segments);
    body.append(name, text);
    row.append(body);
    if (S.settings.direction === "top") list.prepend(row); else list.append(row);
    rows.set(m.id, row);
    trim();
    const hide = Number(S.settings.hideAfter || 0);
    if (hide > 0) setTimeout(() => remove(m.id, true), hide * 1000);
  }

  function layout(s) {
    document.body.dataset.direction = s.direction;
    trim();
  }

  layout(S.settings);
  S.onSettings(layout);
  S.onChat(add);
  S.onChatRemove((ids) => ids.forEach((id) => remove(id, true)));
})();
`;

const CHAT_BASE_CSS = `
${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize)}
#chat{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:var(--s-gap);padding:16px;box-sizing:border-box;overflow:hidden}
body[data-direction="top"] #chat{justify-content:flex-start}
.row{display:flex;align-items:flex-start;gap:.6em;max-width:100%}
.avatar{position:relative;flex:none;width:2em;height:2em;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:.85em}
.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.logo{position:absolute;right:-.3em;bottom:-.25em;width:1em;height:1em;display:grid;place-items:center}
.logo.inline{position:static;flex:none;width:1.1em;height:1.1em;margin-top:.15em}
.logo svg{width:100%;height:100%}
.body{min-width:0;line-height:1.35;overflow-wrap:anywhere}
.name{font-weight:var(--s-nameWeight);margin-right:.4em}
.badge{margin-right:.25em;font-size:.85em}
.label{display:block;font-size:.75em;font-weight:800;margin-bottom:.15em;opacity:.95}
`;

const SCRIPT_TAG = (script: string) => `<script>${ANIMATION_SCRIPT}${script}</script>`;

export const CHAT_PRESETS: OverlayPreset[] = [
  {
    id: "chat-glass",
    name: "Glass chat",
    kind: "chat",
    description: "Frosted cards with avatars and platform logos.",
    accent: "#7dd3fc",
    width: 440,
    height: 720,
    fields: [
      ...chatFields(),
      color("cardColor", "Card", "rgba(12,14,20,0.62)"),
      color("textColor", "Text", "#f8fafc"),
      color("borderColor", "Border", "rgba(255,255,255,0.14)"),
      range("radius", "Corner radius", 16, 0, 32, { unit: "px" }),
      range("blur", "Background blur", 10, 0, 30, { unit: "px", group: "Colors" }),
    ],
    html: `<style>${CHAT_BASE_CSS}
.row{padding:.55em .75em;border-radius:var(--s-radius);background:var(--s-cardColor);color:var(--s-textColor);border:1px solid var(--s-borderColor);backdrop-filter:blur(var(--s-blur));box-shadow:0 8px 28px rgba(0,0,0,.25)}
.name{color:var(--name-color)}
.hl-paid{background:linear-gradient(135deg,rgba(251,191,36,.95),rgba(245,158,11,.9));color:#111;border-color:transparent}
.hl-paid .name{color:#111}
.hl-membership,.hl-subscription{background:linear-gradient(135deg,rgba(139,92,246,.9),rgba(99,102,241,.86));border-color:transparent}
.hl-announcement{background:linear-gradient(135deg,rgba(14,165,233,.9),rgba(59,130,246,.85));border-color:transparent}
</style><div id="chat"></div>${SCRIPT_TAG(CHAT_SCRIPT)}`,
  },
  {
    id: "chat-neon",
    name: "Neon line chat",
    kind: "chat",
    description: "Minimal lines with a glowing accent bar per platform.",
    accent: "#f0abfc",
    width: 460,
    height: 640,
    fields: [
      ...chatFields({ enter: "slide-left", fontSize: 20 }),
      color("textColor", "Text", "#ffffff"),
      color("youtubeColor", "YouTube accent", "#ff3b5c"),
      color("twitchColor", "Twitch accent", "#a970ff"),
      range("glow", "Glow", 14, 0, 40, { unit: "px", group: "Colors" }),
      toggle("shadow", "Text shadow", true, "Colors"),
    ],
    html: `<style>${CHAT_BASE_CSS}
.row{position:relative;padding:.2em 0 .2em .85em;color:var(--s-textColor)}
.row::before{content:"";position:absolute;left:0;top:.25em;bottom:.25em;width:3px;border-radius:3px;background:var(--accent);box-shadow:0 0 var(--s-glow) var(--accent)}
.row[data-platform="youtube"]{--accent:var(--s-youtubeColor)}
.row[data-platform="twitch"]{--accent:var(--s-twitchColor)}
body[data-shadow="1"] .row{text-shadow:0 2px 6px rgba(0,0,0,.85)}
.name{color:var(--accent);text-shadow:0 0 calc(var(--s-glow) / 2) var(--accent)}
.hl{padding:.45em .7em .45em 1em;border-radius:10px;background:rgba(0,0,0,.55)}
</style><div id="chat"></div>${SCRIPT_TAG(`${CHAT_SCRIPT}
(() => { const sync = (s) => { document.body.dataset.shadow = s.shadow ? "1" : "0"; }; sync(SEENALYZE.settings); SEENALYZE.onSettings(sync); })();`)}`,
  },
  {
    id: "chat-bubbles",
    name: "Bubble chat",
    kind: "chat",
    description: "Rounded speech bubbles that pop in, great for vertical streams.",
    accent: "#86efac",
    width: 420,
    height: 760,
    fields: [
      ...chatFields({ enter: "pop", fontSize: 19 }),
      color("bubbleColor", "Bubble", "#ffffff"),
      color("textColor", "Text", "#111827"),
      color("nameColorOverride", "Name color (empty = viewer's)", "transparent"),
      range("radius", "Bubble roundness", 22, 4, 40, { unit: "px" }),
    ],
    html: `<style>${CHAT_BASE_CSS}
.row{align-items:flex-end}
.body{background:var(--s-bubbleColor);color:var(--s-textColor);padding:.55em .85em;border-radius:var(--s-radius) var(--s-radius) var(--s-radius) 6px;box-shadow:0 10px 24px rgba(0,0,0,.18)}
.name{display:block;color:var(--name-color);font-size:.82em;margin-bottom:.1em}
body[data-namecolor="1"] .name{color:var(--s-nameColorOverride)}
.hl-paid .body{background:linear-gradient(135deg,#fde68a,#f59e0b)}
.hl-membership .body,.hl-subscription .body{background:linear-gradient(135deg,#ddd6fe,#a78bfa)}
</style><div id="chat"></div>${SCRIPT_TAG(`${CHAT_SCRIPT}
(() => { const sync = (s) => { document.body.dataset.namecolor = s.nameColorOverride && s.nameColorOverride !== "transparent" ? "1" : "0"; }; sync(SEENALYZE.settings); SEENALYZE.onSettings(sync); })();`)}`,
  },
  {
    id: "chat-compact",
    name: "Compact chat",
    kind: "chat",
    description: "Dense single-line chat for gameplay corners.",
    accent: "#fcd34d",
    width: 400,
    height: 420,
    fields: [
      ...chatFields({ maxMessages: 12, fontSize: 16, enter: "fade" }),
      color("textColor", "Text", "#ffffff"),
      color("panelColor", "Panel", "rgba(0,0,0,0.45)"),
      range("panelPadding", "Panel padding", 10, 0, 32, { unit: "px" }),
      range("radius", "Panel corners", 12, 0, 24, { unit: "px" }),
    ],
    html: `<style>${CHAT_BASE_CSS}
#chat{background:var(--s-panelColor);border-radius:var(--s-radius);padding:var(--s-panelPadding);gap:calc(var(--s-gap) / 2)}
.row{color:var(--s-textColor);text-shadow:0 1px 3px rgba(0,0,0,.8);align-items:center}
.avatar{width:1.4em;height:1.4em}
.name{color:var(--name-color)}
.label{display:inline;margin-right:.4em;padding:0 .35em;border-radius:4px;background:#f59e0b;color:#111}
</style><div id="chat"></div>${SCRIPT_TAG(CHAT_SCRIPT)}`,
  },
];
