import type { LucideIcon } from "lucide-react";
import { useRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { useFocusRescue } from "@/lib/use-focus-rescue";
import { cn } from "@/lib/utils";

export function Dock({
  title,
  actions,
  children,
  className,
  fitContent = false,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Let the content set the dock row's height (up to `className`'s max height) instead of scrolling inside a fixed one. */
  fitContent?: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  useFocusRescue(sectionRef);
  return (
    <section ref={sectionRef} className={cn("flex min-h-0 min-w-0 flex-col rounded-xl border bg-card", className)} aria-label={title}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto", !fitContent && "[contain:size]")}>{children}</div>
    </section>
  );
}

export function DockEmpty({ icon: Icon, text, action }: { icon: LucideIcon; text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <Icon aria-hidden className="size-12 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

export function ListRow({
  active,
  onClick,
  onKeyDown,
  dragging,
  children,
  className,
  ...rest
}: {
  active?: boolean;
  onClick?: () => void;
  /** Row being dragged: lifted above the others while it follows the pointer. */
  dragging?: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "children" | "className" | "role" | "tabIndex">) {
  return (
    <div
      {...rest}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex h-9 select-none items-center gap-2 px-3 text-sm outline-none transition-colors duration-150 focus-visible:bg-accent motion-reduce:transition-none",
        onClick && "cursor-default hover:bg-accent/60",
        active && "bg-accent text-accent-foreground",
        dragging && "cursor-grabbing rounded-md bg-accent shadow-lg ring-1 ring-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
