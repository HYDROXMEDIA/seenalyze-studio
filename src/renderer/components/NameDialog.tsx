import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";

/** Small dialog that asks for a single name (new scene, rename, …). */
export function NameDialog({
  open,
  title,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <NameForm title={title} initial={initial} onDone={() => onOpenChange(false)} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function NameForm({
  title,
  initial,
  onDone,
  onSubmit,
}: {
  title: string;
  initial: string;
  onDone: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const tc = useTranslations("common");
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const clean = value.trim();

  return (
    <DialogContent className="sm:max-w-sm">
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!clean || pending) return;
          setPending(true);
          await onSubmit(clean);
          setPending(false);
          onDone();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={value} maxLength={60} aria-label={tc("name")} onChange={(event) => setValue(event.target.value)} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={!clean || pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
