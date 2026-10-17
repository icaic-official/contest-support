import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { CommandRunner } from "@/connected/hooks/useCommand";

/**
 * A bottom sheet for one task on a phone. The sheet traps focus while it is
 * open and returns focus to the control that opened it. Swipe down, Escape
 * and the Cancel button all close it.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg">{title}</DrawerTitle>
          {description ? (
            <DrawerDescription>{description}</DrawerDescription>
          ) : (
            <DrawerDescription className="sr-only">{title}</DrawerDescription>
          )}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {children}
          <Button
            type="button"
            variant="ghost"
            className="mt-2 h-11 w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The error of the last workflow command and, after a transport failure, a
 * button that sends the same request again with its original request UUID.
 */
export function CommandFeedback({
  command,
  className,
}: {
  command: CommandRunner;
  className?: string;
}) {
  const canRetry = Boolean(command.pending && !command.busy);
  if (!command.error && !canRetry) return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription className="gap-2">
        {command.error && <p role="alert">{command.error}</p>}
        {canRetry && (
          <>
            <p>
              The result of the last request is unknown. Send it again. Minsky
              records it only once.
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={command.retry}
            >
              <RotateCw aria-hidden="true" />
              Retry last request
            </Button>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}
