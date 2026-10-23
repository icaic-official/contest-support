import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A centred dialog for one task in the desktop console. It has the same
 * props as `ActionSheet`, so a form can go in either. The dialog traps focus
 * while it is open and returns focus to the control that opened it. Escape
 * and the Cancel button close it. `onClosed` runs after the closing
 * animation, so the content can stay the same until the dialog is gone.
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  showCancel = true,
  onClosed,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  showCancel?: boolean;
  onClosed?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-h-[90dvh] overflow-y-auto sm:max-w-md", className)}
        onCloseAutoFocus={() => onClosed?.()}
      >
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        <div>
          {children}
          {showCancel && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-11 w-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
