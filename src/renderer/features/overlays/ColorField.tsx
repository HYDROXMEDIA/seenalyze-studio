import { useTranslations } from "use-intl";
import { ColorPicker } from "@/components/ui/color-picker";
export { parseColor, formatColor } from "@/lib/color";

/** Color picker with opacity, since overlays often use translucent panels. */
export function ColorField({ id, value, label, onChange }: { id: string; value: string; label?: string; onChange: (value: string) => void }) {
  const t = useTranslations("overlays.editor");
  return <ColorPicker id={id} label={label ?? t("pickColor")} value={value} onChange={onChange} />;
}
