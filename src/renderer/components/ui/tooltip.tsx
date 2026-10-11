// Tooltips for controls without a visible text label (icon buttons, icon menu
// triggers). One shared provider gives every tooltip the same short delay and
// shows the next one instantly while the pointer moves along a toolbar.

import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useState, type ComponentProps, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { usePreviewOcclusion } from "@/store/studio";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={300} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps = Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, "asChild" | "children"> & {
  /** Short text (a few words) saying what the control does. */
  label: ReactNode;
  /** The control itself; it receives the trigger props. */
  children: ReactElement;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: ComponentProps<typeof TooltipPrimitive.Content>["align"];
};

/** The control's own menu or popover is open: its tooltip would cover it. */
const expanded = (element: Element) => element.getAttribute("aria-expanded") === "true";

/**
 * Shows `label` next to the child on hover and on keyboard focus. Props from an
 * outer `asChild` trigger (menus, popovers) pass through to the child, so it
 * can sit directly inside `ActionMenu` or `PopoverTrigger asChild`.
 *
 * The native preview draws above the web UI, so a visible tooltip counts as a
 * "tooltip" occluder: the preview steps aside only while the tooltip actually
 * overlaps it. Tooltips open below their trigger by default, away from the
 * preview for the docks underneath it.
 */
export function Tooltip({ label, side = "bottom", align = "center", children, onFocus, onPointerMove, onPointerDown, ...props }: TooltipProps) {
  const [open, setOpen] = useState(false);
  usePreviewOcclusion(open, "tooltip");
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger
        asChild
        {...props}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          onFocus?.(event);
          // Focus that returns to the control after a menu or dialog closes
          // (mouse users) must not pop the tooltip; keyboard focus still does.
          // preventDefault only tells the Radix trigger to skip opening.
          if (!event.currentTarget.matches(":focus-visible") || expanded(event.currentTarget)) event.preventDefault();
        }}
        onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
          onPointerMove?.(event);
          if (expanded(event.currentTarget)) event.preventDefault();
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          onPointerDown?.(event);
          // Menu triggers cancel the pointer-down default, which would keep the tooltip up over the opening menu.
          setOpen(false);
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-64 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md select-none animate-ui-tip"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
