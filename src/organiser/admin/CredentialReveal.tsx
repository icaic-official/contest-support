import { useId, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Credentials } from "./useSessionAdmin";

/**
 * The one-time credentials of a new account or a password reset. Each value
 * has a copy button. The text fields are read only, so the admin can also
 * select the text when the browser blocks the clipboard. An event account's
 * link fills in the event code on the sign-in form.
 */
export function CredentialReveal({
  credentials,
  onDone,
}: {
  credentials: Credentials;
  onDone: () => void;
}) {
  const id = useId();
  const [copied, setCopied] = useState("");
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied.`);
    } catch {
      setCopied("Copy is not available. Select the text and copy it.");
    }
  }
  const { origin } = window.location;
  const { signIn } = credentials;
  const rows = [
    ...(signIn?.kind === "event"
      ? [{ key: "link", label: "Sign-in link", value: `${origin}/?event=${signIn.code}` }]
      : signIn?.kind === "site"
        ? [{ key: "link", label: "Sign-in page", value: `${origin}/sign-in` }]
        : []),
    { key: "username", label: "Username", value: credentials.username },
    {
      key: "password",
      label: "Temporary password",
      value: credentials.password,
    },
  ];
  return (
    <section aria-label="Temporary account credentials" className="space-y-4">
      <div className="grid size-11 place-items-center rounded-full bg-status-resolved/15 text-status-resolved">
        <KeyRound aria-hidden="true" className="size-5" />
      </div>
      <p className="text-sm text-muted-foreground">
        This password is shown for this action only. If it is lost, issue a
        new one. The user must change it at the first sign-in.
        {signIn?.kind === "site" && " On the sign-in page, the user selects Site sign-in."}
      </p>
      <div className="divide-y rounded-xl border">
        {rows.map(({ key, label, value }) => (
          <div key={key} className="flex items-end gap-2 p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <label
                htmlFor={`${id}-${key}`}
                className="block text-xs text-muted-foreground"
              >
                {label}
              </label>
              <Input
                id={`${id}-${key}`}
                readOnly
                value={value}
                autoComplete="off"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 font-mono text-base md:text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={`Copy ${label.toLowerCase()}`}
              onClick={() => {
                void copy(label, value);
              }}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {copied}
      </p>
      <Button type="button" className="h-12 w-full text-base" onClick={onDone}>
        Done
      </Button>
    </section>
  );
}
