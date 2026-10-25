import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/organiser/admin/AccountAccess";
import { ActionDialog } from "@/organiser/actions/ActionDialog";
import type { AvatarDraft } from "./avatarPicture";
import type { AvatarEditorControls } from "./hooks/useAvatarEditor";

/** The encoded square, as the server will store it, and how it looks as a circle. */
function DraftPreview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  // Create the URL in an effect, so React StrictMode can run it twice without a revoked URL.
  useEffect(() => {
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-center gap-4">
        <div className="size-44 rounded-lg border bg-muted">
          {url && (
            <img
              src={url}
              alt="Your new picture, cropped to a square"
              className="size-full rounded-lg object-cover"
            />
          )}
        </div>
        <div aria-hidden="true" className="size-16 rounded-full border bg-muted">
          {url && <img src={url} alt="" className="size-full rounded-full object-cover" />}
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        The middle of your image is used. Your picture shows as a circle.
      </p>
    </div>
  );
}

/**
 * Everything the picture controls need besides their buttons: the file
 * input, the step messages and errors, the preview dialog and the removal
 * question. Render it once next to the buttons that call `picture.pick` and
 * `picture.askRemove`.
 */
export function PictureEditor({ picture }: { picture: AvatarEditorControls }) {
  const { editor } = picture;
  const draft: AvatarDraft | undefined =
    editor.phase === "preview" || editor.phase === "uploading" ? editor.draft : undefined;
  // The dialog keeps its content while it closes.
  const lastDraft = useRef<AvatarDraft>(undefined);
  if (draft) lastDraft.current = draft;
  const shownDraft = draft ?? lastDraft.current;
  const uploading = editor.phase === "uploading";
  const saveLabel = uploading
    ? "Saving…"
    : editor.phase === "preview" && editor.error
      ? "Try again"
      : "Save picture";
  const error =
    editor.phase === "idle" || editor.phase === "preview" ? editor.error : "";
  const status =
    editor.phase === "preparing"
      ? "Preparing your picture…"
      : editor.phase === "removing"
        ? "Removing your picture…"
        : "";
  return (
    <>
      <input
        ref={picture.inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a profile picture"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clear the input, so the person can choose the same file again.
          event.target.value = "";
          void picture.choose(file);
        }}
      />
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground empty:hidden"
      >
        {status ? <Spinner className="size-4" /> : null}
        {status}
      </p>
      {editor.phase === "idle" && error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ActionDialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open) picture.cancel();
        }}
        title="Use this picture?"
        description="Check how your new picture looks."
        showCancel={false}
      >
        <div className="grid gap-4">
          {shownDraft && <DraftPreview blob={shownDraft.blob} />}
          {editor.phase === "preview" && editor.error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{editor.error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              type="button"
              className="h-11"
              disabled={uploading}
              loading={uploading}
              onClick={() => void picture.save()}
            >
              {saveLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={uploading}
              onClick={picture.cancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      </ActionDialog>
      <ConfirmDialog
        open={editor.phase === "confirmRemoval"}
        onOpenChange={(open) => {
          if (!open) picture.cancel();
        }}
        title="Remove your picture?"
        description="Your initials show instead. You can add a picture again at any time."
        confirmLabel="Remove picture"
        onConfirm={() => void picture.remove()}
      />
    </>
  );
}
