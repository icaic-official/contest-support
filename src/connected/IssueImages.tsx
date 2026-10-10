import { useEffect, useId, useRef, useState } from "react";
import { attachmentPath, imageKind, imageRejection } from "./imageFile";
import {
  type ImageTransport,
  type StartedImage,
  isImageRequestError,
  liveImageTransport,
  thumbnailBlob,
} from "./imageUpload";
import type { Attachment } from "./model";
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
  onChanged,
  transport = liveImageTransport,
}: {
  sessionId: string;
  issueId: string;
  archived: boolean;
  canUpload: boolean;
  staff: boolean;
  userId: string;
  limits: { maxImageBytes: number; maxImages: number; maxTotalBytes: number };
  attachments: readonly Attachment[];
  onChanged: () => Promise<void>;
  transport?: ImageTransport;
}) {
  const inputId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [visibility, setVisibility] = useState<"public" | "internal">("internal");
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<{ file: File; pending?: StartedImage }>();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Attachment>();
  const [fullUrl, setFullUrl] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const shown = attachments.filter((item) => staff || item.visibility === "public");
  const shownKey = shown.map((item) => item.id).join(" ");
  const totalBytes = shown.reduce((sum, item) => sum + item.byte_size, 0);

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

  async function send(file: File, pending?: StartedImage) {
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const rejection = imageRejection(file.size, imageKind(header), limits, {
      count: shown.length,
      totalBytes,
    });
    if (rejection) {
      setMessage(rejection);
      setRetry(undefined);
      return;
    }
    let preview: Blob;
    try {
      preview = await thumbnailBlob(file);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Choose a JPEG, PNG, or WebP image.");
      setRetry(undefined);
      return;
    }
    setBusy(true);
    setMessage("");
    setProgress(0);
    let started = pending;
    try {
      if (!started) {
        started = await transport.begin({
          sessionId,
          issueId,
          visibility,
          name: file.name,
          bytes: file.size,
        });
      }
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
          await transport.abandon(sessionId, started.id).catch(() => undefined);
        }
        setRetry(undefined);
      } else if (isImageRequestError(cause) && cause.restart) {
        setRetry({ file });
      } else {
        setRetry({ file, pending: started });
      }
      setMessage(text);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function openPreview(item: Attachment, button: HTMLButtonElement) {
    openerRef.current = button;
    setActive(item);
    setFullUrl("");
    dialogRef.current?.showModal();
    try {
      const blob = await transport.download(
        attachmentPath(sessionId, issueId, item.id, "original"),
      );
      setFullUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This image could not be opened.");
    }
  }

  function dismissPreview() {
    dialogRef.current?.close();
  }

  async function remove(item: Attachment) {
    setBusy(true);
    setMessage("");
    try {
      await transport.remove(sessionId, item.id);
      dismissPreview();
      setMessage("Image removed.");
      await onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "This image could not be removed.");
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
            void send(file, retry?.pending);
          }}
        >
          <label>
            Who can see this image
            <select
              name="visibility"
              value={visibility}
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
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={busy}
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
          <button type="submit" disabled={busy || archived}>Add image</button>
          {retry && (
            <button
              type="submit"
              className="quiet"
              disabled={busy}
            >
              Try the upload again
            </button>
          )}
        </form>
      )}
      {archived && <p className="field-help">This event is archived. Images cannot be added.</p>}
      {message && (
        <p className="alert" role="status">{message}</p>
      )}
      <dialog
        ref={dialogRef}
        className="image-preview"
        aria-labelledby={`${inputId}-preview`}
        onClose={() => {
          setActive(undefined);
          setFullUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return "";
          });
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
