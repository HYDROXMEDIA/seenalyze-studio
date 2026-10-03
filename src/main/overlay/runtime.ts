// The SEENALYZE overlay runtime, injected into every overlay document. It is
// the only API overlays (presets and AI-designed ones) use to get data:
//
//   SEENALYZE.settings                current setting values (also CSS vars --s-<key>)
//   SEENALYZE.onSettings(cb)          settings changed in the editor (live)
//   SEENALYZE.onChat(cb)              chat message
//   SEENALYZE.onChatRemove(cb)        message ids deleted by moderators
//   SEENALYZE.onEvent(cb)             follow / sub / cheer / raid / Super Chat / membership …
//   SEENALYZE.onStats(cb)             viewers, followers, session totals, uptime
//   SEENALYZE.platformLogo(platform)  inline SVG markup for "youtube" | "twitch"
//   SEENALYZE.renderSegments(el, segs) safe text + emote rendering
//   SEENALYZE.formatNumber(n)         compact number formatting
//   SEENALYZE.preview                 true inside the editor (demo data flows)
//
// User content must always be inserted as text (renderSegments / textContent).

const YOUTUBE_LOGO = `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#FF0033"/><path d="M11 5.5v9l8-4.5z" fill="#fff"/></svg>`;
const TWITCH_LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>`;

export function overlayRuntime(options: { eventsPath: string | null; settings: Record<string, unknown>; preview: boolean }): string {
  const config = JSON.stringify({
    eventsPath: options.eventsPath,
    settings: options.settings,
    preview: options.preview,
    logos: { youtube: YOUTUBE_LOGO, twitch: TWITCH_LOGO },
  }).replace(/</gu, "\\u003c");

  return `(() => {
  const config = ${config};
  const listeners = { settings: [], chat: [], chatRemove: [], event: [], stats: [] };
  const emit = (kind, payload) => { for (const cb of listeners[kind]) { try { cb(payload); } catch (error) { console.error(error); } } };
  let lastStats = null;

  const api = {
    settings: config.settings,
    preview: config.preview,
    // Called once right away with the current settings, then on every change.
    onSettings: (cb) => { listeners.settings.push(cb); try { cb(api.settings); } catch (error) { console.error(error); } },
    onChat: (cb) => { listeners.chat.push(cb); },
    onChatRemove: (cb) => { listeners.chatRemove.push(cb); },
    onEvent: (cb) => { listeners.event.push(cb); },
    onStats: (cb) => { listeners.stats.push(cb); if (lastStats) cb(lastStats); },
    platformLogo: (platform) => config.logos[platform] || "",
    formatNumber: (value) => {
      const n = Number(value) || 0;
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\\.0$/, "") + "M";
      if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\\.0$/, "") + "K";
      return n.toLocaleString();
    },
    renderSegments: (el, segments) => {
      for (const segment of segments || []) {
        if (segment.type === "emote" && typeof segment.url === "string" && segment.url.startsWith("https://")) {
          const img = document.createElement("img");
          img.src = segment.url;
          img.alt = segment.name || "";
          img.className = "sz-emote";
          img.style.cssText = "height:1.4em;vertical-align:middle;margin:0 .08em";
          el.append(img);
        } else if (segment.type === "text") {
          el.append(document.createTextNode(segment.text));
        }
      }
    },
  };
  window.SEENALYZE = api;

  function applySettings(values, css) {
    Object.assign(api.settings, values);
    const style = document.getElementById("sz-settings");
    if (style && css) style.textContent = css;
    emit("settings", api.settings);
  }

  function handle(message) {
    switch (message.type) {
      case "settings": applySettings(message.values, message.css); break;
      case "chat": message.messages.forEach((m) => emit("chat", m)); break;
      case "chatRemove": emit("chatRemove", message.ids); break;
      case "event": emit("event", message.event); break;
      case "stats": lastStats = message.stats; emit("stats", message.stats); break;
      case "reload": location.reload(); break;
    }
  }

  function connect() {
    if (!config.eventsPath) return;
    const source = new EventSource(config.eventsPath);
    source.onmessage = (event) => { try { handle(JSON.parse(event.data)); } catch (error) { console.error(error); } };
  }

  // ----- demo data for the editor preview ------------------------------------
  const demoNames = ["Nova", "PixelPilot", "Mara", "Zed", "Kiko", "Atlas", "Juniper", "Rook", "Sable", "Echo"];
  const demoLines = [
    "this overlay looks clean", "hello from the stream!", "GG that was insane", "first time here, love it",
    "what settings are you using?", "LET'S GOOO", "the animations are so smooth", "hi chat 👋",
  ];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const platform = () => (Math.random() < 0.5 ? "youtube" : "twitch");
  let demoSeq = 0;
  const demoChat = () => ({
    id: "demo:" + (++demoSeq), platform: platform(), accountId: "demo", authorId: "demo-" + demoSeq,
    authorName: pick(demoNames), badges: Math.random() < 0.2 ? ["moderator"] : [],
    segments: [{ type: "text", text: pick(demoLines) }], timestamp: Date.now(),
  });
  const demoEvent = (type) => {
    const p = type === "superChat" || type === "membership" || type === "memberMilestone" || type === "giftMembership" || type === "superSticker" ? "youtube"
      : type === "follow" || type === "cheer" || type === "raid" || type === "subscription" || type === "resub" || type === "giftSub" || type === "redemption" ? "twitch" : platform();
    const base = { id: "demo-event:" + (++demoSeq), platform: p, type, userName: pick(demoNames), timestamp: Date.now() };
    switch (type) {
      case "superChat": return { ...base, amount: 10, amountLabel: "$10.00", message: "Keep it up!" };
      case "cheer": return { ...base, amount: 500, amountLabel: "500 bits", message: "cheer500 amazing" };
      case "raid": return { ...base, count: 42 };
      case "resub": return { ...base, months: 12, tier: "1000", message: "a whole year!" };
      case "giftSub": return { ...base, count: 5, tier: "1000" };
      case "memberMilestone": return { ...base, months: 6 };
      case "giftMembership": return { ...base, count: 3 };
      default: return base;
    }
  };
  const demoTypes = ["follow", "subscription", "superChat", "cheer", "raid", "membership", "resub", "giftSub"];
  let demoStats = { viewers: { youtube: 128, twitch: 214, total: 342 }, followers: 12840, subscribers: 3210, members: 412,
    sessionFollows: 7, sessionSubs: 3, sessionBits: 1200, sessionSuperChatTotalLabel: "$45.00", uptimeSeconds: 3725, live: true };

  function startDemo() {
    handle({ type: "stats", stats: demoStats });
    for (let i = 0; i < 4; i += 1) setTimeout(() => handle({ type: "chat", messages: [demoChat()] }), 150 * i);
    setInterval(() => handle({ type: "chat", messages: [demoChat()] }), 2200);
    setInterval(() => handle({ type: "event", event: demoEvent(pick(demoTypes)) }), 7000);
    setTimeout(() => handle({ type: "event", event: demoEvent("follow") }), 900);
    setInterval(() => {
      const yt = Math.max(0, demoStats.viewers.youtube + Math.round((Math.random() - 0.45) * 6));
      const tw = Math.max(0, demoStats.viewers.twitch + Math.round((Math.random() - 0.45) * 8));
      demoStats = { ...demoStats, viewers: { youtube: yt, twitch: tw, total: yt + tw }, uptimeSeconds: demoStats.uptimeSeconds + 3,
        sessionFollows: demoStats.sessionFollows + (Math.random() < 0.3 ? 1 : 0) };
      handle({ type: "stats", stats: demoStats });
    }, 3000);
    // The editor's "test" buttons post messages into the preview frame.
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "seenalyze-editor") return;
      if (data.kind === "chat") handle({ type: "chat", messages: [demoChat()] });
      else if (data.kind === "event" && typeof data.eventType === "string") handle({ type: "event", event: demoEvent(data.eventType) });
      else if (data.kind === "settings") applySettings(data.values || {}, data.css);
    });
  }

  connect();
  if (config.preview) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startDemo);
    else startDemo();
  }
})();`;
}
