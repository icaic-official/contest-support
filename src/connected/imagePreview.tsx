import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IssueImages } from "./IssueImages";
import { ImageRequestError } from "../backend/errors";
import type { ImageTransport } from "../backend/contracts";
import type { Attachment, PendingRemoval } from "./model";
import "../index.css";

const sessionId = "00000000-0000-4000-8000-000000000100";
const issueId = "00000000-0000-4000-8000-000000000301";
const ada = "00000000-0000-4000-8000-000000000003";
const previewResponse = new URLSearchParams(window.location.search).get("previewResponse");
const pixel = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (char) => char.charCodeAt(0));

/** This page shows, previews and removes images. It never uploads. */
const cannotUpload = async (): Promise<never> => {
  throw new ImageRequestError("The preview page cannot add images.");
};

function Preview({
  title,
  staff,
  archived = false,
  attachments,
  initialPendingRemovals = [],
}: {
  title: string;
  staff: boolean;
  archived?: boolean;
  attachments: Attachment[];
  initialPendingRemovals?: PendingRemoval[];
}) {
  const [images, setImages] = useState(attachments);
  const [pendingRemovals, setPendingRemovals] = useState(initialPendingRemovals);
  const removals = useRef(initialPendingRemovals.length ? 1 : 0);
  const transport = useMemo<ImageTransport>(() => ({
    begin: cannotUpload,
    upload: cannotUpload,
    finish: cannotUpload,
    abandon: cannotUpload,
    async remove(_session, attachmentId) {
      setImages((current) => current.filter((item) => item.id !== attachmentId));
      removals.current += 1;
      if (removals.current === 1) {
        setPendingRemovals([{ id: attachmentId, issue_id: issueId, original_name: "screen.png" }]);
        throw new ImageRequestError("The stored files could not be deleted. Try again.");
      }
      setPendingRemovals([]);
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
        staff={staff}
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

const second: Attachment = {
  ...existing,
  id: "00000000-0000-4000-8000-000000000403",
  uploaded_at: "2026-10-11T02:20:00.000Z",
  visibility: "public",
  original_name: "new.png",
};

createRoot(document.getElementById("root")!).render(
  <main className="legacy-ui">
    <Preview title="Staff images" staff attachments={[existing]} />
    <Preview title="Several images" staff attachments={[existing, second]} />
    <Preview title="Contestant images" staff={false} attachments={[{
      ...existing,
      id: "00000000-0000-4000-8000-000000000402",
      visibility: "public",
    }]} />
    <Preview title="Archived images" staff archived attachments={[existing]} />
    <Preview title="Pending removal" staff attachments={[]} initialPendingRemovals={[{
      id: existing.id,
      issue_id: issueId,
      original_name: existing.original_name,
    }]} />
  </main>,
);
