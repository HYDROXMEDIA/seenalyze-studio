// Builds the full HTML document for an overlay: settings as CSS variables,
// the runtime API, then the overlay's own markup.

import { resolveValues, settingsToCss, type OverlayDefinition } from "../../shared/overlays";
import { overlayRuntime } from "./runtime";

const BASE_CSS = "html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%}";

/** Content policy for overlay documents: no external code, no external requests except images. */
export const OVERLAY_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; media-src https: data:; font-src data:; connect-src 'self'";

/** `eventsPath` is the live feed URL; null for previews that only show demo data. */
export function buildOverlayDocument(
  overlay: Pick<OverlayDefinition, "html" | "fields" | "values">,
  preview: boolean,
  eventsPath: string | null,
): string {
  const settings = resolveValues(overlay.fields, overlay.values);
  const css = settingsToCss(overlay.fields, overlay.values).replace(/<\//gu, "<\\/");
  const runtime = overlayRuntime({ eventsPath, settings, preview });
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${BASE_CSS}</style><style id="sz-settings">${css}</style><script>${runtime}</script>`;

  const html = overlay.html.replace(/<!doctype[^>]*>/iu, "");
  const headTag = /<head[^>]*>/iu.exec(html);
  if (headTag) {
    const index = headTag.index + headTag[0].length;
    return `<!doctype html>${html.slice(0, index)}${head}${html.slice(index)}`;
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
