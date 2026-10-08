// Dialog, alert dialog, popover, native menu and select primitives. Every web
// root tracks its open state with usePreviewOcclusion so the native preview
// steps aside while a floating surface is visible; native menus draw above it.

import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive, Popover as PopoverPrimitive, Select as SelectPrimitive, Slot } from "radix-ui";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps, type MouseEvent, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { usePreviewOcclusion, type OcclusionKind } from "@/store/studio";
import { Button } from "./button";

/**
 * Wraps a Radix root so the native preview is hidden exactly while it is open.
 * Works for controlled (open prop) and uncontrolled roots.
 */
function useTrackedOpen(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
  kind: OcclusionKind = "modal",
) {
  const [internal, setInternal] = useState(defaultOpen ?? false);
  const current = open ?? internal;
  usePreviewOcclusion(current, kind);
  return {
    open: current,
    onOpenChange: (next: boolean) => {
      if (open === undefined) setInternal(next);
      onOpenChange?.(next);
    },
  };
}

// ----- Dialog ----------------------------------------------------------------

export function Dialog({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange)} />;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass =
  "fixed inset-0 z-50 bg-black/60 animate-ui-fade";
const contentClass =
  "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg animate-ui-pop";

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  const t = useTranslations("common");
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content className={cn(contentClass, "sm:max-w-lg", className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <XIcon className="size-4" />
          <span className="sr-only">{t("close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 text-left", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg leading-none font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

// ----- Popover ---------------------------------------------------------------

export function Popover({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange)} />;
}

export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, sideOffset = 8, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ----- Alert dialog ----------------------------------------------------------

export function AlertDialog({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof AlertPrimitive.Root>) {
  return <AlertPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange)} />;
}

export function AlertDialogContent({ className, ...props }: ComponentProps<typeof AlertPrimitive.Content>) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={overlayClass} />
      <AlertPrimitive.Content className={cn(contentClass, "sm:max-w-md", className)} {...props} />
    </AlertPrimitive.Portal>
  );
}

// Must use the alert primitive's own Title: Radix scopes the alert dialog's
// context, so a plain Dialog title throws "must be used within Dialog" here.
export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertPrimitive.Title>) {
  return <AlertPrimitive.Title className={cn("text-lg leading-none font-semibold", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertPrimitive.Description>) {
  return <AlertPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function AlertDialogAction({ className, ...props }: ComponentProps<typeof AlertPrimitive.Action>) {
  return (
    <AlertPrimitive.Action asChild>
      <Button className={cn("bg-red-600 text-white hover:bg-red-700", className)} {...(props as ComponentProps<typeof Button>)} />
    </AlertPrimitive.Action>
  );
}

export function AlertDialogCancel(props: ComponentProps<typeof AlertPrimitive.Cancel>) {
  return (
    <AlertPrimitive.Cancel asChild>
      <Button variant="outline" {...(props as ComponentProps<typeof Button>)} />
    </AlertPrimitive.Cancel>
  );
}

// ----- Native menu ---------------------------------------------------------

export type NativeMenuItem = { label: string; onSelect: () => void; disabled?: boolean; checked?: boolean } | "separator";

/**
 * Opens an OS menu below the child trigger. Native menus draw above the
 * preview surface, so the preview stays visible while they are open.
 */
export function NativeMenu({ items, children }: { items: NativeMenuItem[]; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const show = async (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (open) return;
    const box = event.currentTarget.getBoundingClientRect();
    setOpen(true);
    try {
      const entries = items.map((item) => (item === "separator" ? { separator: true } : { label: item.label, enabled: !item.disabled, checked: item.checked }));
      const index = await studio.showMenu(entries, { x: box.left, y: box.bottom + 4 });
      const chosen = index === null ? undefined : items[index];
      if (chosen && chosen !== "separator" && !chosen.disabled) chosen.onSelect();
    } finally {
      setOpen(false);
    }
  };
  return (
    <Slot.Root aria-haspopup="menu" aria-expanded={open} data-state={open ? "open" : "closed"} onClick={(event: MouseEvent<HTMLElement>) => void show(event).catch(console.error)}>
      {children}
    </Slot.Root>
  );
}

// ----- Select ----------------------------------------------------------------

export function Select({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange, "popper")} />;
}
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground dark:bg-input/30 *:data-[slot=select-value]:line-clamp-1",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-ui-pop",
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
