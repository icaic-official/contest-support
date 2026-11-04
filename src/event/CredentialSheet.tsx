import { useState } from "react";
import { Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  ReturningDialogContent as DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CredentialSheetState } from "./useEventConsole";

/**
 * The temporary passwords of a batch, shown once. A row whose password did not
 * come back (a lost response, or a failed batch) has an "Issue again" button.
 * The dialog cannot close by accident while a batch runs.
 */
export function CredentialSheet({
  sheet,
  code,
  names,
  handles,
  onIssueAgain,
  onClose,
}: {
  sheet: CredentialSheetState;
  /** The event code that the sign-in link names. */
  code: string;
  names: ReadonlyMap<string, string>;
  /** Handles from the console, for rows that have not returned yet. */
  handles: ReadonlyMap<string, string>;
  onIssueAgain: (accountIds: readonly string[]) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState("");
  const link = `${window.location.origin}/?event=${code}`;
  const missing = sheet.rows.filter((row) => row.state === "lost" || row.state === "failed");
  const text = [
    `Sign-in link: ${link}`,
    ...sheet.rows
      .filter((row) => row.password)
      .map((row) => `${names.get(row.accountId) ?? ""}\t${row.handle ?? handles.get(row.accountId) ?? ""}\t${row.password}`),
  ].join("\n");
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied.`);
    } catch {
      setCopied("Copy is not available. Select the text and copy it.");
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !sheet.busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle>Share these credentials securely</DialogTitle>
          <DialogDescription>
            Each password is shown once. People change it at their first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Sign-in link</p>
            <p className="font-mono text-sm break-all">{link}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Copy sign-in link"
            onClick={() => void copy("Link", link)}
          >
            <Copy aria-hidden="true" />
          </Button>
        </div>
        <ul aria-label="Credentials" className="divide-y rounded-xl border">
          {sheet.rows.map((row) => (
            <li key={row.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <div className="min-w-0 flex-1 basis-40 leading-tight">
                <p className="truncate text-sm font-medium">{names.get(row.accountId) ?? "Account"}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.handle ?? handles.get(row.accountId) ?? ""}
                </p>
              </div>
              {row.password ? (
                <>
                  <output className="font-mono text-sm break-all select-all" aria-label={`Password for ${names.get(row.accountId) ?? "account"}`}>
                    {row.password}
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={`Copy password for ${names.get(row.accountId) ?? "account"}`}
                    onClick={() => void copy("Password", row.password ?? "")}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {row.state === "waiting"
                    ? "Waiting"
                    : row.state === "lost"
                      ? "The password did not arrive."
                      : "Not issued."}
                </p>
              )}
            </li>
          ))}
        </ul>
        {sheet.error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{sheet.error}</p>
            </AlertDescription>
          </Alert>
        )}
        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {sheet.busy ? "Issuing passwords…" : copied}
        </p>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!text.includes("\t")}
            onClick={() => void copy("Credentials", text)}
          >
            Copy all
          </Button>
          {missing.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={sheet.busy}
              onClick={() => onIssueAgain(missing.map((row) => row.accountId))}
            >
              Issue again ({missing.length})
            </Button>
          )}
          <Button type="button" className="h-11" disabled={sheet.busy} onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
