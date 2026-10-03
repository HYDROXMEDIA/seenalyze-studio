// Self-contained on-stream chat overlay page. It is rendered by the engine's
// built-in browser as a scene source, so it has a transparent background and
// no external dependencies besides emote/avatar images.
//
// URL options (query string):
//   platforms=all|youtube|twitch   which chats to show (default all)
//   max=1..30                      messages kept on screen (default 10)
//   hide=0..600                    seconds before a message fades out, 0 = never (default 0)
//   scale=0.5..3                   text size multiplier (default 1)

const YOUTUBE_LOGO = `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#FF0033"/><path d="M11 5.5v9l8-4.5z" fill="#fff"/></svg>`;
const TWITCH_LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>`;

export function chatOverlayPage(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>SEENALYZE STUDIO chat</title>
<style>
  :root { --scale: 1; }
  html, body { margin: 0; background: transparent; overflow: hidden; height: 100%; }
  body { font-family: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif; font-size: calc(17px * var(--scale)); }
  #list { position: absolute; inset: auto 0 0 0; display: flex; flex-direction: column; gap: calc(8px * var(--scale)); padding: calc(12px * var(--scale)); }
  .msg { display: flex; gap: calc(10px * var(--scale)); align-items: flex-start; padding: calc(10px * var(--scale)) calc(12px * var(--scale));
    border-radius: calc(14px * var(--scale)); background: rgba(10, 10, 12, 0.72); color: #fff; backdrop-filter: blur(6px);
    box-shadow: 0 6px 24px rgba(0,0,0,.28); animation: in 420ms cubic-bezier(.2,.9,.25,1.15) both; transform-origin: left bottom; }
  .msg.out { animation: out 360ms ease-in both; }
  .msg.paid { background: linear-gradient(135deg, rgba(251,191,36,.92), rgba(245,158,11,.86)); color: #111; }
  .msg.membership, .msg.subscription { background: linear-gradient(135deg, rgba(139,92,246,.88), rgba(99,102,241,.84)); }
  .msg.announcement { background: linear-gradient(135deg, rgba(14,165,233,.86), rgba(59,130,246,.82)); }
  .avatar { position: relative; flex: none; width: calc(32px * var(--scale)); height: calc(32px * var(--scale)); }
  .avatar img, .avatar .initial { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
  .avatar .initial { display: grid; place-items: center; font-weight: 700; color: #fff; }
  .logo { position: absolute; right: calc(-5px * var(--scale)); bottom: calc(-4px * var(--scale)); width: calc(16px * var(--scale)); height: calc(16px * var(--scale));
    border-radius: 50%; background: #111; display: grid; place-items: center; padding: 1px; }
  .logo svg { width: 100%; height: 100%; }
  .body { min-width: 0; line-height: 1.35; overflow-wrap: anywhere; }
  .label { display: inline-block; font-size: .78em; font-weight: 800; margin-bottom: 2px; }
  .name { font-weight: 700; margin-right: 6px; }
  .emote { height: 1.6em; vertical-align: middle; margin: 0 1px; }
  @keyframes in { from { opacity: 0; transform: translateY(18px) scale(.94); } to { opacity: 1; transform: none; } }
  @keyframes out { to { opacity: 0; transform: translateX(-24px); } }
</style>
</head>
<body>
<div id="list"></div>
<script>
(() => {
  const params = new URLSearchParams(location.search);
  const platforms = (params.get("platforms") || "all").toLowerCase();
  const clamp = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
  const max = clamp(params.get("max"), 1, 30, 10);
  const hideAfter = clamp(params.get("hide"), 0, 600, 0) * 1000;
  document.documentElement.style.setProperty("--scale", String(clamp(params.get("scale"), 0.5, 3, 1)));
  const logos = { youtube: ${JSON.stringify(YOUTUBE_LOGO)}, twitch: ${JSON.stringify(TWITCH_LOGO)} };
  const palette = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#a3e635"];
  const list = document.getElementById("list");
  const nodes = new Map();

  const colorFor = (message) => {
    if (message.authorColor) return message.authorColor;
    let hash = 0;
    for (const char of message.authorId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  };
  const wanted = (message) => platforms === "all" || platforms.split(",").includes(message.platform);
  const safeUrl = (url) => typeof url === "string" && url.startsWith("https://") ? url : null;

  function remove(id, animate) {
    const node = nodes.get(id);
    if (!node) return;
    nodes.delete(id);
    if (!animate) { node.remove(); return; }
    node.classList.add("out");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  }

  function render(message) {
    if (!wanted(message) || nodes.has(message.id)) return;
    const row = document.createElement("div");
    row.className = "msg" + (message.highlight ? " " + message.highlight.kind : "");
    // Kept for moderation removals (bans and channel clears).
    row.dataset.author = message.platform + ":" + message.authorId;
    row.dataset.account = message.accountId;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const avatarUrl = safeUrl(message.avatarUrl);
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.referrerPolicy = "no-referrer";
      avatar.append(img);
    } else {
      const initial = document.createElement("div");
      initial.className = "initial";
      initial.style.background = colorFor(message);
      initial.textContent = (message.authorName || "?").slice(0, 1).toUpperCase();
      avatar.append(initial);
    }
    const logo = document.createElement("div");
    logo.className = "logo";
    logo.innerHTML = logos[message.platform] || "";
    avatar.append(logo);

    const body = document.createElement("div");
    body.className = "body";
    if (message.highlight && message.highlight.label) {
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = message.highlight.label;
      body.append(label, document.createElement("br"));
    }
    const name = document.createElement("span");
    name.className = "name";
    name.style.color = message.highlight ? "inherit" : colorFor(message);
    name.textContent = message.authorName;
    body.append(name);
    for (const segment of message.segments) {
      if (segment.type === "emote" && safeUrl(segment.url)) {
        const img = document.createElement("img");
        img.className = "emote";
        img.src = segment.url;
        img.alt = segment.name;
        body.append(img);
      } else if (segment.type === "text") {
        body.append(document.createTextNode(segment.text));
      }
    }
    row.append(avatar, body);
    list.append(row);
    nodes.set(message.id, row);
    while (nodes.size > max) remove(nodes.keys().next().value, false);
    if (hideAfter > 0) setTimeout(() => remove(message.id, true), hideAfter);
  }

  function handle(event) {
    switch (event.type) {
      case "state": event.messages.slice(-max).forEach(render); break;
      case "messages": event.messages.forEach(render); break;
      case "remove": event.ids.forEach((id) => remove(id, true)); break;
      case "removeAuthor":
        for (const [id, node] of nodes) if (node.dataset.author === event.platform + ":" + event.authorId) remove(id, true);
        break;
      case "clear":
        for (const [id, node] of nodes) if (node.dataset.account === event.accountId) remove(id, false);
        break;
    }
  }

  const source = new EventSource("events");
  source.onmessage = (event) => { try { handle(JSON.parse(event.data)); } catch (error) { console.error(error); } };
})();
</script>
</body>
</html>`;
}
