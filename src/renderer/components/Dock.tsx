import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dock({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-xl border bg-card", className)} aria-label={title}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function DockEmpty({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <img src={icon} alt="" className="size-12" draggable={false} />
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

export function ListRow({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex h-9 items-center gap-2 px-3 text-sm outline-none focus-visible:bg-accent",
        onClick && "cursor-default hover:bg-accent/60",
        active && "bg-accent text-accent-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
