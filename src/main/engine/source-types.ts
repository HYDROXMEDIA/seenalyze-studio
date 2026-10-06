import type { SourceKind } from "../../shared/types";

/** Source availability follows the installed engine and its OS modules. */
export const INPUT_IDS: Record<Exclude<SourceKind, "scene">, { darwin: string[]; win32: string[] }> = {
  display: { darwin: ["screen_capture", "mac_screen_capture", "display_capture"], win32: ["monitor_capture"] },
  window: { darwin: ["screen_capture", "mac_screen_capture", "window_capture"], win32: ["window_capture"] },
  application: { darwin: ["screen_capture", "mac_screen_capture"], win32: [] },
  game: { darwin: [], win32: ["game_capture"] },
  camera: { darwin: ["av_capture_input_v2", "macos_avcapture", "av_capture_input"], win32: ["dshow_input"] },
  captureCard: { darwin: ["av_capture_input_v2", "macos_avcapture", "av_capture_input"], win32: ["dshow_input"] },
  microphone: { darwin: ["coreaudio_input_capture"], win32: ["wasapi_input_capture"] },
  desktopAudio: { darwin: ["sck_audio_capture", "coreaudio_output_capture"], win32: ["wasapi_output_capture"] },
  applicationAudio: { darwin: ["sck_audio_capture"], win32: ["wasapi_process_output_capture"] },
  image: { darwin: ["image_source"], win32: ["image_source"] },
  slideshow: { darwin: ["slideshow_v2", "slideshow"], win32: ["slideshow_v2", "slideshow"] },
  media: { darwin: ["ffmpeg_source"], win32: ["ffmpeg_source"] },
  playlist: { darwin: ["vlc_source"], win32: ["vlc_source"] },
  text: { darwin: ["text_ft2_source_v2", "text_ft2_source"], win32: ["text_gdiplus_v3", "text_gdiplus", "text_ft2_source_v2"] },
  color: { darwin: ["color_source_v3", "color_source"], win32: ["color_source_v3", "color_source"] },
  browser: { darwin: ["browser_source"], win32: ["browser_source"] },
  chatOverlay: { darwin: ["browser_source"], win32: ["browser_source"] },
  overlay: { darwin: ["browser_source"], win32: ["browser_source"] },
  syphon: { darwin: ["syphon-input"], win32: [] },
  blackmagic: { darwin: ["decklink-input"], win32: ["decklink-input"] },
};

export function resolveSourceType(kind: SourceKind, installed: Iterable<string>, platform = process.platform): string | undefined {
  if (kind === "scene" || !Object.hasOwn(INPUT_IDS, kind)) return undefined;
  const ids = new Set(installed);
  const candidates = platform === "win32" ? INPUT_IDS[kind].win32 : platform === "darwin" ? INPUT_IDS[kind].darwin : [];
  return candidates.find((id) => ids.has(id));
}

export function availableSourceKinds(installed: Iterable<string>, platform = process.platform): SourceKind[] {
  const ids = new Set(installed);
  return [...(Object.keys(INPUT_IDS) as Exclude<SourceKind, "scene">[]).filter((kind) => resolveSourceType(kind, ids, platform)), "scene"];
}
