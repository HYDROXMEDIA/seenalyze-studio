// Dialog, alert dialog, dropdown menu and select primitives. Every root tracks
// its open state with usePreviewOcclusion so the native preview steps aside
// while a floating surface is visible.

import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive, DropdownMenu as MenuPrimitive, Popover as PopoverPrimitive, Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useTranslations } from "use-intl";
import { cn } from "@/lib/utils";
import { usePreviewOcclusion } from "@/store/studio";
import { Button } from "./button";

/**
 * Wraps a Radix root so the native preview is hidden exactly while it is open.
 * Works for controlled (open prop) and uncontrolled roots.
 */
function useTrackedOpen(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const [internal, setInternal] = useState(defaultOpen ?? false);
  const current = open ?? internal;
  usePreviewOcclusion(current);
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
  "fixed inset-0 z-50 bg-black/60";
const contentClass =
  "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg";

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

// ----- Dropdown menu ---------------------------------------------------------

export function DropdownMenu({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange)} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "destructive" && "text-red-600 focus:bg-red-600/10 focus:text-red-600 dark:text-red-400",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

// ----- Select ----------------------------------------------------------------

export function Select({ open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} {...useTrackedOpen(open, defaultOpen, onOpenChange)} />;
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
          "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
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
