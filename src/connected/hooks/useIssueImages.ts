import { useEffect, useRef, useState } from "react";
import { backend } from "@/backend";
import type { ImageTransport, StartedImage } from "@/backend/contracts";
import { ImageRequestError } from "@/backend/errors";
import { attachmentPath, imageKind, imageRejection } from "../imageFile";
import { isImageRequestError, thumbnailBlob } from "../imageUpload";
import type { Attachment, PendingRemoval } from "../model";

/** The image limits of a session, in bytes and images. */
export interface ImageLimits {
  maxImageBytes: number;
  maxImages: number;
  maxTotalBytes: number;
}

/** An upload whose result is unknown, or whose unfinished files remain. */
export interface ImageRetry {
  file: File;
  requestId: string;
  pending?: StartedImage | undefined;
  /** True when only the deletion of unfinished files can continue. */
  cleanupOnly?: boolean;
}

/** Options for useIssueImages. */
export interface IssueImagesOptions {
  sessionId: string;
  issueId: string;
  /** Staff see staff-only images too. */
  staff: boolean;
  limits: ImageLimits;
  attachments: readonly Attachment[];
  pendingRemovals: readonly PendingRemoval[];
  onChanged: () => Promise<void>;
  transport?: ImageTransport | undefined;
  /**
   * Returns whether the preview is still on screen. A late download for a
   * closed preview is ignored. The default uses the open preview state.
   */
  isPreviewOpen?: () => boolean;
  /** Runs when the preview closes, for example to close a native dialog. */
  onPreviewClose?: () => void;
}

/** The image state and actions of one issue. */
export interface IssueImagesState {
  /** The images that this person can see. */
  shown: Attachment[];
  /** Object URLs of the thumbnails. "" marks a failed thumbnail. */
  thumbs: Record<string, string>;
  /** Removals whose stored files still need deletion. */
  removals: PendingRemoval[];
  visibility: "public" | "internal";
  setVisibility: (visibility: "public" | "internal") => void;
  /** Upload progress in percent while an upload runs. */
  progress: number | undefined;
  message: string;
  setMessage: (message: string) => void;
  retry: ImageRetry | undefined;
  clearRetry: () => void;
  busy: boolean;
  /** The plain-language image limits. */
  limitText: string;
  /**
   * Uploads a file, or continues the upload in `retry`. Resolves to true when
   * the image was added, so the caller can clear its file input.
   */
  send: (file: File) => Promise<boolean>;
  /** Deletes the unfinished files of the upload in `retry`. */
  cancelUpload: () => Promise<boolean>;
  remove: (item: PendingRemoval) => Promise<void>;
  /** The image in the preview, if any. */
  active: Attachment | undefined;
  /** The object URL of the full image in the preview, or "" while it loads. */
  fullUrl: string;
  openPreview: (item: Attachment) => Promise<void>;
  closePreview: () => void;
}

/**
 * Loads thumbnails, uploads images with a fixed visibility, opens previews
 * and removes images. The visibility of an upload cannot change while it
 * waits for a retry. A late preview response for a closed or replaced
 * preview is ignored.
 */
export function useIssueImages({
  sessionId,
  issueId,
  staff,
  limits,
  attachments,
  pendingRemovals,
  onChanged,
  transport = backend.images,
  isPreviewOpen,
  onPreviewClose,
}: IssueImagesOptions): IssueImagesState {
  const previewRequest = useRef(0);
  const previewOpen = useRef(false);
  const [visibility, setVisibility] = useState<"public" | "internal">(
    "internal",
  );
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<ImageRetry>();
  const [failedRemoval, setFailedRemoval] = useState<PendingRemoval>();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Attachment>();
  const [fullUrl, setFullUrl] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const shown = attachments.filter(
    (item) => staff || item.visibility === "public",
  );
  const shownKey = shown.map((item) => item.id).join(" ");
  const totalBytes = shown.reduce((sum, item) => sum + item.byte_size, 0);
  const removals =
    failedRemoval &&
    !pendingRemovals.some((item) => item.id === failedRemoval.id)
      ? [...pendingRemovals, failedRemoval]
      : [...pendingRemovals];
  const stillOpen = isPreviewOpen ?? (() => previewOpen.current);

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

  async function send(file: File): Promise<boolean> {
    const pending = retry?.pending;
    const requestId = retry?.requestId ?? crypto.randomUUID();
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
          return true;
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
      if (rejection) {
        throw new ImageRequestError(rejection, { validation: true });
      }
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
      await transport.upload(
        started.original_path,
        file,
        imageKind(header) ?? "application/octet-stream",
        (amount) => {
          setProgress(Math.min(99, Math.round((amount / total) * 100)));
        },
      );
      await transport.upload(
        started.thumbnail_path,
        preview,
        "image/jpeg",
        (amount) => {
          setProgress(
            Math.min(100, Math.round(((file.size + amount) / total) * 100)),
          );
        },
      );
      await transport.finish(sessionId, started.id);
      setRetry(undefined);
      setMessage("Image added.");
      await onChanged();
      return true;
    } catch (cause) {
      const text =
        cause instanceof Error
          ? cause.message
          : "Upload failed. Check your connection and try again.";
      if (isImageRequestError(cause) && cause.validation) {
        if (started) {
          try {
            await transport.abandon(sessionId, started.id);
          } catch {
            setRetry({ file, requestId, pending: started, cleanupOnly: true });
            setMessage(
              `${text} The unfinished files could not be deleted. Use Cancel upload to try again.`,
            );
            return false;
          }
        }
        setRetry(undefined);
      } else {
        setRetry({ file, requestId, pending: started });
      }
      setMessage(text);
      return false;
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function cancelUpload(): Promise<boolean> {
    if (!retry) return false;
    setBusy(true);
    setMessage("");
    try {
      // Reuse the request ID if the begin response was lost, so cancellation
      // finds the original upload instead of leaving an unknown pending row.
      const pending =
        retry.pending ??
        (await transport.begin({
          requestId: retry.requestId,
          sessionId,
          issueId,
          visibility,
          name: retry.file.name,
          bytes: retry.file.size,
        }));
      await transport.abandon(sessionId, pending.id);
      setRetry(undefined);
      setMessage(
        "Upload canceled. You can choose another image or visibility.",
      );
      return true;
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The unfinished files could not be deleted. Try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(item: Attachment) {
    const request = ++previewRequest.current;
    previewOpen.current = true;
    setActive(item);
    setFullUrl("");
    try {
      const blob = await transport.download(
        attachmentPath(sessionId, issueId, item.id, "original"),
      );
      // A closed, replaced, or unmounted preview must ignore its late response.
      if (request !== previewRequest.current || !stillOpen()) return;
      setFullUrl(URL.createObjectURL(blob));
    } catch (cause) {
      if (request !== previewRequest.current || !stillOpen()) return;
      setMessage(
        cause instanceof Error ? cause.message : "This image could not be opened.",
      );
    }
  }

  function closePreview() {
    previewRequest.current++;
    previewOpen.current = false;
    setActive(undefined);
    setFullUrl("");
    onPreviewClose?.();
  }

  async function remove(item: PendingRemoval) {
    setBusy(true);
    setMessage("");
    try {
      await transport.remove(sessionId, item.id);
      setFailedRemoval(undefined);
      closePreview();
      setMessage("Image removed.");
      await onChanged();
    } catch (cause) {
      setFailedRemoval(item);
      closePreview();
      setMessage(
        cause instanceof Error ? cause.message : "This image could not be removed.",
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return {
    shown,
    thumbs,
    removals,
    visibility,
    setVisibility,
    progress,
    message,
    setMessage,
    retry,
    clearRetry: () => setRetry(undefined),
    busy,
    limitText: `JPEG, PNG, or WebP. Up to ${Math.round(limits.maxImageBytes / 1048576)} MB each, ${limits.maxImages} images, and ${Math.round(limits.maxTotalBytes / 1048576)} MB per issue.`,
    send,
    cancelUpload,
    remove,
    active,
    fullUrl,
    openPreview,
    closePreview,
  };
}
