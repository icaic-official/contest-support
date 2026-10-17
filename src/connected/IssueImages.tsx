import { useId, useRef } from "react";
import { type ImageLimits, useIssueImages } from "./hooks/useIssueImages";
import type { ImageTransport } from "./imageUpload";
import type { Attachment, PendingRemoval } from "./model";
import { Icon } from "./ui";

export function IssueImages({
  sessionId,
  issueId,
  archived,
  canUpload,
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
  canUpload: boolean;
  staff: boolean;
  userId: string;
  limits: ImageLimits;
  attachments: readonly Attachment[];
  pendingRemovals: readonly PendingRemoval[];
  onChanged: () => Promise<void>;
  transport?: ImageTransport;
}) {
  const inputId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const {
    shown,
    thumbs,
    removals,
    visibility,
    setVisibility,
    progress,
    message,
    retry,
    busy,
    active,
    fullUrl,
    limitText,
  } = images;

  function openPreview(item: Attachment, button: HTMLButtonElement) {
    openerRef.current = button;
    dialogRef.current?.showModal();
    void images.openPreview(item);
  }

  const dismissPreview = images.closePreview;
  const remove = images.remove;

  async function cancelUpload() {
    if ((await images.cancelUpload()) && fileRef.current) {
      fileRef.current.value = "";
    }
  }

  return (
    <section className="images" aria-labelledby={`${inputId}-heading`}>
      <div className="activity-heading">
        <h3 id={`${inputId}-heading`}>Images</h3>
        <span>{shown.length}</span>
      </div>
      {shown.length === 0 && <p className="field-help">No images attached.</p>}
      {shown.length > 0 && (
        <ul className="image-list">
          {shown.map((item) => {
            const when = new Date(item.uploaded_at).toLocaleString();
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="image-thumb"
                  aria-label={`View image uploaded by ${item.uploader_name} on ${when}`}
                  onClick={(event) => {
                    openPreview(item, event.currentTarget);
                  }}
                >
                  {thumbs[item.id]
                    ? <img src={thumbs[item.id]} alt="" />
                    : <span className="image-fallback">Preview unavailable</span>}
                  <span className="image-caption">
                    {item.uploader_name}
                    <time dateTime={item.uploaded_at}>{when}</time>
                    {item.visibility === "internal" && (
                      <span className="internal-label">
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
      {canUpload && (
        <form
          className="section-form"
          onSubmit={(event) => {
            event.preventDefault();
            const selected = new FormData(event.currentTarget).get("image");
            const file = retry?.file ?? (selected instanceof File ? selected : undefined);
            if (!file || file.size === 0) {
              images.setMessage("Choose a JPEG, PNG, or WebP image.");
              return;
            }
            void images.send(file);
          }}
        >
          <label>
            Who can see this image
            <select
              name="visibility"
              value={visibility}
              disabled={busy || Boolean(retry)}
              onChange={(event) => {
                setVisibility(event.target.value === "public" ? "public" : "internal");
              }}
            >
              <option value="internal">Staff only</option>
              <option value="public">Visible to the team</option>
            </select>
          </label>
          <label htmlFor={inputId}>
            Image file
            <input
              id={inputId}
              ref={fileRef}
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={busy || Boolean(retry)}
              onChange={() => images.clearRetry()}
            />
          </label>
          <p className="field-help" id={`${inputId}-limits`}>{limitText}</p>
          {progress !== undefined && (
            <>
              <p id={`${inputId}-progress`}>Uploading image, {progress}%.</p>
              <progress
                aria-labelledby={`${inputId}-progress`}
                value={progress}
                max={100}
              />
            </>
          )}
          {retry && <p className="field-help">The visibility choice stays fixed for this upload. Cancel the upload to change it.</p>}
          <button type="submit" disabled={busy || archived || Boolean(retry)}>Add image</button>
          {retry && !retry.cleanupOnly && (
            <button
              type="submit"
              className="quiet"
              disabled={busy}
            >
              Try the upload again
            </button>
          )}
          {retry && (
            <button type="button" className="quiet" disabled={busy} onClick={() => {
              void cancelUpload();
            }}>
              Cancel upload
            </button>
          )}
        </form>
      )}
      {removals.map((item) => (
        <div className="image-removal-retry" key={item.id}>
          <p>The files for {item.original_name} still need to be deleted.</p>
          <button type="button" className="quiet" disabled={busy} onClick={() => {
            void remove(item);
          }}>
            Retry removal
          </button>
        </div>
      ))}
      {archived && <p className="field-help">This event is archived. Images cannot be added.</p>}
      {message && (
        <p className="alert" role="status">{message}</p>
      )}
      <dialog
        ref={dialogRef}
        className="image-preview"
        aria-labelledby={`${inputId}-preview`}
        onClose={(event) => {
          // A queued close event can arrive after another preview opens.
          if (event.currentTarget.open) return;
          images.closePreview();
          openerRef.current?.focus();
        }}
      >
        {active && (
          <>
            <h3 id={`${inputId}-preview`}>
              Image uploaded by {active.uploader_name} on{" "}
              {new Date(active.uploaded_at).toLocaleString()}
            </h3>
            {active.visibility === "internal" && (
              <p className="internal-label"><Icon name="lock" /> Staff only</p>
            )}
            {fullUrl
              ? (
                <img
                  src={fullUrl}
                  alt={`Image uploaded by ${active.uploader_name} on ${new Date(active.uploaded_at).toLocaleString()}`}
                />
              )
              : <p>Opening image.</p>}
            <div className="image-preview-actions">
              {fullUrl && (
                <a href={fullUrl} download={active.original_name}>Download image</a>
              )}
              {active.uploader === userId && !archived && (
                <button type="button" className="quiet" disabled={busy} onClick={() => {
                  void remove(active);
                }}>
                  Remove image
                </button>
              )}
              <button type="button" className="quiet" onClick={dismissPreview}>Close</button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
