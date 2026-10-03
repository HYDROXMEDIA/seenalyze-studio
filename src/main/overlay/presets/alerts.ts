import type { OverlayField, OverlayPreset } from "../../../shared/overlays";
import { ANIMATION_CSS, ANIMATION_SCRIPT, animationFields, color, font, range, text, toggle } from "./fields";

/** Event toggles + message templates ({name} {amount} {months} {count}). */
function alertFields(enter: string): OverlayField[] {
  return [
    toggle("onFollow", "Follows", true),
    toggle("onSubscription", "Subscriptions and resubs", true),
    toggle("onGift", "Gifted subs and memberships", true),
    toggle("onCheer", "Bits", true),
    toggle("onRaid", "Raids", true),
    toggle("onSuperChat", "Super Chats and Stickers", true),
    toggle("onMembership", "New members and milestones", true),
    toggle("onRedemption", "Channel point rewards", false),
    text("tFollow", "Follow text", "{name} just followed!"),
    text("tSubscription", "Sub text", "{name} subscribed!"),
    text("tResub", "Resub text", "{name} resubscribed for {months} months!"),
    text("tGift", "Gift text", "{name} gifted {count}!"),
    text("tCheer", "Bits text", "{name} cheered {amount}!"),
    text("tRaid", "Raid text", "{name} is raiding with {count} viewers!"),
    text("tSuperChat", "Super Chat text", "{name} sent {amount}"),
    text("tMembership", "Member text", "{name} became a member!"),
    text("tMilestone", "Milestone text", "{name} has been a member for {months} months!"),
    text("tRedemption", "Reward text", "{name} redeemed {message}"),
    toggle("showMessage", "Show viewer's message", true),
    range("displaySeconds", "Show each alert for", 6, 2, 20, { unit: "s", group: "Behavior" }),
    font(),
    range("fontSize", "Text size", 34, 16, 80, { unit: "px", group: "Typography" }),
    ...animationFields({ enter, duration: 600 }),
  ];
}

const ALERT_SCRIPT = `
(() => {
  const S = SEENALYZE;
  const stage = document.getElementById("alert");
  const queue = [];
  let busy = false;
  const enabled = {
    follow: "onFollow", subscription: "onSubscription", resub: "onSubscription", giftSub: "onGift", giftMembership: "onGift",
    cheer: "onCheer", raid: "onRaid", superChat: "onSuperChat", superSticker: "onSuperChat",
    membership: "onMembership", memberMilestone: "onMembership", redemption: "onRedemption",
  };
  const templates = {
    follow: "tFollow", subscription: "tSubscription", resub: "tResub", giftSub: "tGift", giftMembership: "tGift",
    cheer: "tCheer", raid: "tRaid", superChat: "tSuperChat", superSticker: "tSuperChat",
    membership: "tMembership", memberMilestone: "tMilestone", redemption: "tRedemption",
  };
  const icons = { follow: "♥", subscription: "★", resub: "★", giftSub: "🎁", giftMembership: "🎁", cheer: "◆", raid: "⚑",
    superChat: "$", superSticker: "$", membership: "✦", memberMilestone: "✦", redemption: "✪" };

  function fill(template, e) {
    const values = { name: e.userName, amount: e.amountLabel || (e.amount != null ? String(e.amount) : ""),
      months: e.months != null ? String(e.months) : "", count: e.count != null ? String(e.count) : "", message: e.message || "" };
    return String(template || "").replace(/\\{(name|amount|months|count|message)\\}/g, (_, key) => values[key]);
  }

  function show(e) {
    busy = true;
    stage.replaceChildren();
    const card = document.createElement("div");
    card.className = "card sz-in t-" + e.type;
    card.dataset.platform = e.platform;
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = icons[e.type] || "★";
    const logo = document.createElement("div");
    logo.className = "logo";
    logo.innerHTML = S.platformLogo(e.platform);
    icon.append(logo);
    const body = document.createElement("div");
    body.className = "content";
    const title = document.createElement("div");
    title.className = "title";
    const full = fill(S.settings[templates[e.type]], e);
    const name = e.userName || "";
    const at = name ? full.indexOf(name) : -1;
    if (at >= 0) {
      title.append(document.createTextNode(full.slice(0, at)));
      const strong = document.createElement("span");
      strong.className = "who";
      strong.textContent = name;
      title.append(strong, document.createTextNode(full.slice(at + name.length)));
    } else {
      title.textContent = full;
    }
    body.append(title);
    if (S.settings.showMessage && e.message && e.type !== "redemption") {
      const message = document.createElement("div");
      message.className = "message";
      message.textContent = e.message;
      body.append(message);
    }
    card.append(icon, body);
    stage.append(card);
    setTimeout(() => {
      card.classList.add("sz-out");
      card.addEventListener("animationend", () => { card.remove(); busy = false; next(); }, { once: true });
    }, Number(S.settings.displaySeconds || 6) * 1000);
  }

  function next() {
    if (busy || queue.length === 0) return;
    show(queue.shift());
  }

  S.onEvent((e) => {
    const key = enabled[e.type];
    if (!key || !S.settings[key]) return;
    queue.push(e);
    if (queue.length > 30) queue.shift();
    next();
  });
})();
`;

const ALERT_BASE_CSS = `
${ANIMATION_CSS}
body{font-family:var(--s-font);font-size:var(--s-fontSize)}
#alert{position:absolute;inset:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
.logo{position:absolute;right:-.15em;bottom:-.15em;width:.55em;height:.55em}
.logo svg{width:100%;height:100%}
.icon{position:relative}
.who{color:var(--s-accentColor)}
.message{margin-top:.35em;font-size:.55em;opacity:.9;font-weight:500}
`;

const script = (extra = "") => `<script>${ANIMATION_SCRIPT}${ALERT_SCRIPT}${extra}</script>`;

export const ALERT_PRESETS: OverlayPreset[] = [
  {
    id: "alert-spotlight",
    name: "Spotlight alert",
    kind: "alert",
    description: "Big centered card with a glowing icon and bouncy entrance.",
    accent: "#facc15",
    width: 900,
    height: 360,
    fields: [
      ...alertFields("pop"),
      color("cardColor", "Card", "rgba(10,10,14,0.82)"),
      color("textColor", "Text", "#ffffff"),
      color("accentColor", "Accent", "#facc15"),
      range("radius", "Corner radius", 28, 0, 60, { unit: "px" }),
      range("glow", "Glow", 40, 0, 120, { unit: "px", group: "Colors" }),
    ],
    html: `<style>${ALERT_BASE_CSS}
.card{display:flex;align-items:center;gap:.7em;padding:.7em 1.1em;border-radius:var(--s-radius);background:var(--s-cardColor);color:var(--s-textColor);box-shadow:0 0 var(--s-glow) color-mix(in srgb,var(--s-accentColor) 55%,transparent),0 20px 50px rgba(0,0,0,.4);border:2px solid color-mix(in srgb,var(--s-accentColor) 60%,transparent)}
.icon{flex:none;width:1.9em;height:1.9em;border-radius:50%;display:grid;place-items:center;background:var(--s-accentColor);color:#111;font-size:1.3em;font-weight:900;animation:spin-in calc(var(--s-duration) * 1.6) var(--sz-ease) both}
.title{font-weight:800;line-height:1.15}
@keyframes spin-in{from{transform:rotate(-180deg) scale(0)}to{transform:none}}
</style><div id="alert"></div>${script()}`,
  },
  {
    id: "alert-banner",
    name: "Slide banner alert",
    kind: "alert",
    description: "Wide banner that slides in with a sweeping shine.",
    accent: "#38bdf8",
    width: 1200,
    height: 220,
    fields: [
      ...alertFields("slide-left"),
      color("bannerFrom", "Banner start", "#0ea5e9"),
      color("bannerTo", "Banner end", "#6366f1"),
      color("textColor", "Text", "#ffffff"),
      color("accentColor", "Name highlight", "#fde047"),
      range("skew", "Slant", 8, 0, 20, { unit: "deg" }),
    ],
    html: `<style>${ALERT_BASE_CSS}
.card{position:relative;overflow:hidden;display:flex;align-items:center;gap:.6em;padding:.45em 1.4em;color:var(--s-textColor);background:linear-gradient(110deg,var(--s-bannerFrom),var(--s-bannerTo));transform-origin:left center;transform:skewX(calc(var(--s-skew) * -1));box-shadow:0 18px 40px rgba(0,0,0,.35)}
.card>*{transform:skewX(var(--s-skew))}
.card::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.45) 50%,transparent 70%);transform:translateX(-100%);animation:shine 1.6s ease .4s both}
.icon{font-size:1.2em}
.title{font-weight:800;white-space:nowrap}
@keyframes shine{to{transform:translateX(100%)}}
</style><div id="alert"></div>${script()}`,
  },
  {
    id: "alert-burst",
    name: "Confetti burst alert",
    kind: "alert",
    description: "Celebration burst of confetti around a clean label.",
    accent: "#fb7185",
    width: 900,
    height: 500,
    fields: [
      ...alertFields("pop"),
      color("labelColor", "Label", "#ffffff"),
      color("textColor", "Text", "#111827"),
      color("accentColor", "Name highlight", "#e11d48"),
      range("pieces", "Confetti pieces", 40, 0, 120, { group: "Animation" }),
    ],
    html: `<style>${ALERT_BASE_CSS}
.card{position:relative;display:flex;align-items:center;gap:.6em;padding:.6em 1.1em;border-radius:999px;background:var(--s-labelColor);color:var(--s-textColor);box-shadow:0 18px 50px rgba(0,0,0,.35)}
.icon{font-size:1.2em;color:var(--s-accentColor)}
.title{font-weight:800}
.piece{position:absolute;left:50%;top:50%;width:10px;height:16px;border-radius:2px;animation:fly 1.6s cubic-bezier(.15,.7,.3,1) both;pointer-events:none}
@keyframes fly{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(var(--x),var(--y)) rotate(var(--r));opacity:0}}
</style><div id="alert"></div>${script(`
(() => {
  const colors = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#facc15"];
  // Burst whenever a new alert card appears (queued alerts burst when shown).
  const burst = (card) => {
    const count = Number(SEENALYZE.settings.pieces || 0);
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("span");
      piece.className = "piece";
      const angle = Math.random() * Math.PI * 2;
      const distance = 160 + Math.random() * 260;
      piece.style.setProperty("--x", Math.cos(angle) * distance + "px");
      piece.style.setProperty("--y", Math.sin(angle) * distance + "px");
      piece.style.setProperty("--r", (Math.random() * 720 - 360) + "deg");
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = Math.random() * 0.15 + "s";
      card.append(piece);
      setTimeout(() => piece.remove(), 2000);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.classList && node.classList.contains("card")) burst(node);
  }).observe(document.getElementById("alert"), { childList: true });
})();`)}`,
  },
];
