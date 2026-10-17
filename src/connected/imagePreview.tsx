import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IssueImages } from "./IssueImages";
import { ImageRequestError } from "./imageFile";
import type { ImageTransport, StartedImage } from "./imageUpload";
import type { Attachment, PendingRemoval } from "./model";
import "../index.css";

const sessionId = "00000000-0000-4000-8000-000000000100";
const issueId = "00000000-0000-4000-8000-000000000301";
const ada = "00000000-0000-4000-8000-000000000003";
const previewResponse = new URLSearchParams(window.location.search).get("previewResponse");
const pixel = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (char) => char.charCodeAt(0));

function Preview({
  title,
  canUpload,
  archived = false,
  attachments,
  initialPendingRemovals = [],
}: {
  title: string;
  canUpload: boolean;
  archived?: boolean;
  attachments: Attachment[];
  initialPendingRemovals?: PendingRemoval[];
}) {
  const [images, setImages] = useState(attachments);
  const [pendingRemovals, setPendingRemovals] = useState(initialPendingRemovals);
  const uploads = useRef(0);
  const removals = useRef(initialPendingRemovals.length ? 1 : 0);
  const pending = useRef(new Map<string, {
    visibility: "public" | "internal";
    name: string;
    bytes: number;
    original: boolean;
    thumbnail: boolean;
    ready: boolean;
  }>());
  const requests = useRef(new Map<string, string>());
  const transport = useMemo<ImageTransport>(() => ({
    async begin(input): Promise<StartedImage> {
      const id = requests.current.get(input.requestId) ?? crypto.randomUUID();
      if (!requests.current.has(input.requestId)) {
        requests.current.set(input.requestId, id);
        pending.current.set(id, {
          visibility: input.visibility,
          name: input.name,
          bytes: input.bytes,
          original: false,
          thumbnail: false,
          ready: false,
        });
      }
      return {
        id,
        original_path: `${input.sessionId}/${input.issueId}/${id}/original`,
        thumbnail_path: `${input.sessionId}/${input.issueId}/${id}/thumbnail`,
      };
    },
    async upload(path, body, _type, onProgress) {
      uploads.current += 1;
      onProgress(Math.round(body.size / 2));
      if (body instanceof File && body.name.includes("fail") && uploads.current === 1) {
        throw new ImageRequestError("Upload failed. Check your connection and try again.");
      }
      const image = pending.current.get(path.split("/")[2]);
      if (!image) throw new ImageRequestError("Image unavailable.");
      if (image.ready) throw new ImageRequestError("You do not have permission to add images to this issue.", { validation: true });
      if (path.endsWith("/original")) image.original = true;
      if (path.endsWith("/thumbnail")) image.thumbnail = true;
      onProgress(body.size);
    },
    async finish(_session, attachmentId) {
      const image = pending.current.get(attachmentId);
      if (!image?.original || !image.thumbnail) {
        throw new ImageRequestError("Upload the image before finishing.", { restart: true });
      }
      if (image.ready) return;
      image.ready = true;
      setImages((current) => [...current, {
        id: attachmentId,
        issue_id: issueId,
        uploader: ada,
        uploader_name: "Ada Lovelace",
        uploaded_at: new Date().toISOString(),
        visibility: image.visibility,
        byte_size: image.bytes,
        content_type: "image/png",
        original_name: image.name,
      }]);
      if (image.name.includes("finish-response")) {
        throw new ImageRequestError("Upload failed. Check your connection and try again.", { restart: true });
      }
    },
    async remove(_session, attachmentId) {
      setImages((current) => current.filter((item) => item.id !== attachmentId));
      removals.current += 1;
      if (removals.current === 1) {
        setPendingRemovals([{ id: attachmentId, issue_id: issueId, original_name: "screen.png" }]);
        throw new ImageRequestError("The stored files could not be deleted. Try again.");
      }
      setPendingRemovals([]);
    },
    async abandon(_session, attachmentId) {
      pending.current.delete(attachmentId);
    },
    async download(path) {
      if (previewResponse && path.endsWith(`${existing.id}/original`)) {
        await new Promise((resolve) => window.setTimeout(resolve, 10_000));
        if (previewResponse === "fail") {
          throw new ImageRequestError("This image could not be opened.");
        }
      }
      return new Blob([pixel], { type: "image/png" });
    },
  }), []);
  return (
    <section className="panel detail" aria-label={title}>
      <h2>{title}</h2>
      <IssueImages
        sessionId={sessionId}
        issueId={issueId}
        archived={archived}
        canUpload={canUpload && !archived}
        staff={canUpload || archived}
        userId={ada}
        limits={{ maxImageBytes: 10 * 1048576, maxImages: 12, maxTotalBytes: 120 * 1048576 }}
        attachments={images}
        pendingRemovals={pendingRemovals}
        onChanged={async () => {}}
        transport={transport}
      />
    </section>
  );
}

const existing: Attachment = {
  id: "00000000-0000-4000-8000-000000000401",
  issue_id: issueId,
  uploader: ada,
  uploader_name: "Ada Lovelace",
  uploaded_at: "2026-10-11T02:15:00.000Z",
  visibility: "internal",
  byte_size: pixel.byteLength,
  content_type: "image/png",
  original_name: "screen.png",
};

createRoot(document.getElementById("root")!).render(
  <main className="legacy-ui">
    <Preview title="Staff images" canUpload attachments={[existing]} />
    <Preview title="Contestant images" canUpload={false} attachments={[{
      ...existing,
      id: "00000000-0000-4000-8000-000000000402",
      visibility: "public",
    }]} />
    <Preview title="Archived images" canUpload archived attachments={[existing]} />
    <Preview title="Pending removal" canUpload attachments={[]} initialPendingRemovals={[{
      id: existing.id,
      issue_id: issueId,
      original_name: existing.original_name,
    }]} />
  </main>,
);
