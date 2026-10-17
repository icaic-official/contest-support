import { useEffect, useId, useRef, useState } from "react";
import { attachmentPath, imageKind, imageRejection } from "./imageFile";
import { isImageRequestError, thumbnailBlob } from "./imageUpload";
import { requireBackend } from "../backend";
import type { ImageTransport, StartedImage } from "../backend/contracts";
import { ImageRequestError } from "../backend/errors";
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
  transport = requireBackend().images,
}: {
  sessionId: string;
  issueId: string;
  archived: boolean;
  canUpload: boolean;
  staff: boolean;
  userId: string;
  limits: { maxImageBytes: number; maxImages: number; maxTotalBytes: number };
  attachments: readonly Attachment[];
  pendingRemovals: readonly PendingRemoval[];
  onChanged: () => Promise<void>;
  transport?: ImageTransport;
}) {
  const inputId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const previewRequest = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<"public" | "internal">("internal");
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<{
    file: File;
    requestId: string;
    pending?: StartedImage;
    cleanupOnly?: boolean;
  }>();
  const [failedRemoval, setFailedRemoval] = useState<PendingRemoval>();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Attachment>();
  const [fullUrl, setFullUrl] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const shown = attachments.filter((item) => staff || item.visibility === "public");
  const shownKey = shown.map((item) => item.id).join(" ");
  const totalBytes = shown.reduce((sum, item) => sum + item.byte_size, 0);
  const removals = failedRemoval && !pendingRemovals.some((item) => item.id === failedRemoval.id)
    ? [...pendingRemovals, failedRemoval]
    : pendingRemovals;

  useEffect(() => {
    return () => {
      if (fullUrl) URL.revokeObjectURL(fullUrl);
    };
  }, [fullUrl]);

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const item of shown) {
        try {
          const blob = await transport.download(
            attachmentPath(sessionId, issueId, item.id, "thumbnail"),
          );
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          next[item.id] = url;
        } catch {
          if (!cancelled) next[item.id] = "";
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // shownKey captures the visible attachment set for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId, sessionId, shownKey, transport]);

  async function send(file: File, pending?: StartedImage, requestId: string = crypto.randomUUID()) {
    setBusy(true);
    setMessage("");
    setProgress(0);
    setRetry({ file, requestId, pending });
    let started = pending;
    try {
      // A previous finish response may have been lost. Check completion before
      // writing again: Storage correctly rejects changes to a ready image.
      if (started) {
        try {
          await transport.finish(sessionId, started.id);
          setRetry(undefined);
          setMessage("Image added.");
          await onChanged();
          return;
        } catch (cause) {
          if (!(isImageRequestError(cause) && cause.incomplete)) {
            throw cause;
          }
        }
      }
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const rejection = imageRejection(file.size, imageKind(header), limits, {
        count: shown.length,
        totalBytes,
      });
      if (rejection) throw new ImageRequestError(rejection, { validation: true });
      const preview = await thumbnailBlob(file);
      if (!started) {
        started = await transport.begin({
          requestId,
          sessionId,
          issueId,
          visibility,
          name: file.name,
          bytes: file.size,
        });
      }
      setRetry({ file, requestId, pending: started });
      const total = file.size + preview.size;
      let loaded = 0;
      await transport.upload(
        started.original_path,
        file,
        imageKind(header) ?? "application/octet-stream",
        (amount) => {
          loaded = amount;
          setProgress(Math.min(99, Math.round((loaded / total) * 100)));
        },
      );
      await transport.upload(
        started.thumbnail_path,
        preview,
        "image/jpeg",
        (amount) => {
          setProgress(Math.min(100, Math.round(((file.size + amount) / total) * 100)));
        },
      );
      await transport.finish(sessionId, started.id);
      setRetry(undefined);
      setMessage("Image added.");
      await onChanged();
    } catch (cause) {
      const text = cause instanceof Error
        ? cause.message
        : "Upload failed. Check your connection and try again.";
      if (isImageRequestError(cause) && cause.validation) {
        if (started) {
          try {
            await transport.abandon(sessionId, started.id);
          } catch {
            setRetry({ file, requestId, pending: started, cleanupOnly: true });
            setMessage(`${text} The unfinished files could not be deleted. Use Cancel upload to try again.`);
            return;
          }
        }
        setRetry(undefined);
      } else {
        setRetry({ file, requestId, pending: started });
      }
      setMessage(text);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function cancelUpload() {
    if (!retry) return;
    setBusy(true);
    setMessage("");
    try {
      // Reuse the request ID if the begin response was lost, so cancellation
      // finds the original upload instead of leaving an unknown pending row.
      const pending = retry.pending ?? await transport.begin({
        requestId: retry.requestId,
        sessionId,
        issueId,
        visibility,
        name: retry.file.name,
        bytes: retry.file.size,
      });
      await transport.abandon(sessionId, pending.id);
      setRetry(undefined);
      if (fileRef.current) fileRef.current.value = "";
      setMessage("Upload canceled. You can choose another image or visibility.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The unfinished files could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(item: Attachment, button: HTMLButtonElement) {
    const request = ++previewRequest.current;
    openerRef.current = button;
    setActive(item);
    setFullUrl("");
    dialogRef.current?.showModal();
    try {
      const blob = await transport.download(
        attachmentPath(sessionId, issueId, item.id, "original"),
      );
      // A closed, replaced, or unmounted preview must ignore its late response.
      if (request !== previewRequest.current || !dialogRef.current?.open) return;
      setFullUrl(URL.createObjectURL(blob));
    } catch (cause) {
      if (request !== previewRequest.current || !dialogRef.current?.open) return;
      setMessage(cause instanceof Error ? cause.message : "This image could not be opened.");
    }
  }

  function dismissPreview() {
    previewRequest.current++;
    dialogRef.current?.close();
  }

  async function remove(item: PendingRemoval) {
    setBusy(true);
    setMessage("");
    try {
      await transport.remove(sessionId, item.id);
      setFailedRemoval(undefined);
      dismissPreview();
      setMessage("Image removed.");
      await onChanged();
    } catch (cause) {
      setFailedRemoval(item);
      dismissPreview();
      setMessage(cause instanceof Error ? cause.message : "This image could not be removed.");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const limitText =
    `JPEG, PNG, or WebP. Up to ${Math.round(limits.maxImageBytes / 1048576)} MB each, ${limits.maxImages} images, and ${Math.round(limits.maxTotalBytes / 1048576)} MB per issue.`;
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
                    void openPreview(item, event.currentTarget);
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
              setMessage("Choose a JPEG, PNG, or WebP image.");
              return;
            }
            void send(file, retry?.pending, retry?.requestId);
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
              onChange={() => setRetry(undefined)}
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
          previewRequest.current++;
          setActive(undefined);
          setFullUrl("");
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
