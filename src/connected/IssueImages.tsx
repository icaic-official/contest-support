import { useId, useRef } from "react";
import { type ImageLimits, useIssueImages } from "./hooks/useIssueImages";
import type { ImageTransport } from "@/backend/contracts";
import { Spinner } from "@/components/ui/spinner";
import type { Attachment, PendingRemoval } from "./model";
import { Icon } from "./ui";

export function IssueImages({
  sessionId,
  issueId,
  archived,
  staff,
  userId,
  limits,
  attachments,
  pendingRemovals,
  onChanged,
  transport,
}: {
  sessionId: string;
  issueId: string;
  archived: boolean;
  staff: boolean;
  userId: string;
  limits: ImageLimits;
  attachments: readonly Attachment[];
  pendingRemovals: readonly PendingRemoval[];
  onChanged: () => Promise<void>;
  transport?: ImageTransport | undefined;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const images = useIssueImages({
    sessionId,
    issueId,
    staff,
    limits,
    attachments,
    pendingRemovals,
    onChanged,
    transport,
    isPreviewOpen: () => Boolean(dialogRef.current?.open),
    onPreviewClose: () => dialogRef.current?.close(),
  });
  const { shown, thumbs, removals, message, busy, active, fullUrl } = images;

  function openPreview(item: Attachment, button: HTMLButtonElement) {
    openerRef.current = button;
    dialogRef.current?.showModal();
    void images.openPreview(item);
  }

  const dismissPreview = images.closePreview;
  const remove = images.remove;

  return (
    <section className="images grid gap-3" aria-labelledby={`${id}-heading`}>
      <div className="activity-heading flex items-baseline gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-medium">Images</h3>
        <span className="text-xs text-muted-foreground">{shown.length}</span>
      </div>
      {shown.length === 0 && <p className="field-help text-sm text-muted-foreground">No images attached.</p>}
      {shown.length > 0 && (
        <ul className="image-list grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {shown.map((item) => {
            const when = new Date(item.uploaded_at).toLocaleString();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="image-thumb grid w-full content-start gap-2 overflow-hidden rounded-lg border bg-card p-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={`View image uploaded by ${item.uploader_name} on ${when}`}
                  onClick={(event) => {
                    openPreview(item, event.currentTarget);
                  }}
                >
                  {thumbs[item.id]
                    ? <img src={thumbs[item.id]} alt="" className="aspect-[4/3] w-full rounded-md bg-muted object-cover" />
                    : (
                      <span className="image-fallback grid aspect-[4/3] w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">
                        {thumbs[item.id] === undefined
                          ? <Spinner className="size-5" />
                          : "Preview unavailable"}
                      </span>
                    )}
                  <span className="image-caption grid min-w-0 gap-0.5 text-xs break-words text-muted-foreground">
                    {item.uploader_name}
                    <time dateTime={item.uploaded_at}>{when}</time>
                    {item.visibility === "internal" && (
                      <span className="internal-label flex items-center gap-1 text-status-escalated [&_svg]:size-3">
                        <Icon name="lock" /> Staff only
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {removals.map((item) => (
        <div className="image-removal-retry" key={item.id}>
          <p>The files for {item.original_name} still need to be deleted.</p>
          <button type="button" className="quiet max-lg:min-h-11" disabled={busy} onClick={() => {
            void remove(item);
          }}>
            Retry removal
          </button>
        </div>
      ))}
      {archived && <p className="field-help">This event is archived. Images cannot be added.</p>}
      {message && (
        <p className="alert rounded-md border px-3 py-2 text-sm" role="status">{message}</p>
      )}
      <dialog
        ref={dialogRef}
        className="image-preview m-auto max-h-[calc(100%-2rem)] w-[min(960px,calc(100%-2rem))] overflow-auto rounded-xl border bg-background p-5 text-foreground backdrop:bg-black/70"
        aria-labelledby={`${id}-preview`}
        onClose={(event) => {
          // A queued close event can arrive after another preview opens.
          if (event.currentTarget.open) return;
          images.closePreview();
          openerRef.current?.focus();
        }}
      >
        {active && (
          <>
            <h3 id={`${id}-preview`} className="font-medium">
              Image uploaded by {active.uploader_name} on{" "}
              {new Date(active.uploaded_at).toLocaleString()}
            </h3>
            {active.visibility === "internal" && (
              <p className="internal-label"><Icon name="lock" /> Staff only</p>
            )}
            {fullUrl
              ? (
                <img
                  className="mx-auto my-3 block max-h-[70vh] max-w-full object-contain"
                  src={fullUrl}
                  alt={`Image uploaded by ${active.uploader_name} on ${new Date(active.uploaded_at).toLocaleString()}`}
                />
              )
              : (
                <p className="my-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Opening image.
                </p>
              )}
            <div className="image-preview-actions flex flex-wrap gap-3">
              {fullUrl && (
                <a
                  href={fullUrl}
                  download={active.original_name}
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 max-lg:h-11 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Download image
                </a>
              )}
              {active.uploader === userId && !archived && (
                <button type="button" className="quiet max-lg:min-h-11" disabled={busy} onClick={() => {
                  void remove(active);
                }}>
                  Remove image
                </button>
              )}
              <button
                type="button"
                className="quiet inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent max-lg:h-11 max-lg:min-w-11"
                onClick={dismissPreview}
              >
                Close
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
