import type { OverlayPreset } from "../../../shared/overlays";
import { ALERT_PRESETS } from "./alerts";
import { CHAT_PRESETS } from "./chat";
import { SCENE_PRESETS } from "./scenes";
import { WIDGET_PRESETS } from "./widgets";

export const OVERLAY_PRESETS: OverlayPreset[] = [...CHAT_PRESETS, ...ALERT_PRESETS, ...WIDGET_PRESETS, ...SCENE_PRESETS];

export function findPreset(id: string): OverlayPreset | undefined {
  return OVERLAY_PRESETS.find((preset) => preset.id === id);
}
