import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IssueImages } from "./IssueImages";
import { ImageRequestError } from "./imageFile";
import type { ImageTransport, StartedImage } from "./imageUpload";
import type { Attachment } from "./model";
import "../styles.css";

const sessionId = "00000000-0000-4000-8000-000000000100";
const issueId = "00000000-0000-4000-8000-000000000301";
const ada = "00000000-0000-4000-8000-000000000003";
const pixel = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (char) => char.charCodeAt(0));

function Preview({
  title,
  canUpload,
  archived = false,
  attachments,
}: {
  title: string;
  canUpload: boolean;
  archived?: boolean;
  attachments: Attachment[];
}) {
  const [images, setImages] = useState(attachments);
  const uploads = useRef(0);
  const transport = useMemo<ImageTransport>(() => ({
    async begin(input): Promise<StartedImage> {
      const id = crypto.randomUUID();
      return {
        id,
        original_path: `${input.sessionId}/${input.issueId}/${id}/original`,
        thumbnail_path: `${input.sessionId}/${input.issueId}/${id}/thumbnail`,
      };
    },
    async upload(_path, body, _type, onProgress) {
      uploads.current += 1;
      onProgress(Math.round(body.size / 2));
      if (body instanceof File && body.name.includes("fail") && uploads.current === 1) {
        throw new ImageRequestError("Upload failed. Check your connection and try again.");
      }
      onProgress(body.size);
    },
    async finish() {},
    async remove(_session, attachmentId) {
      setImages((current) => current.filter((item) => item.id !== attachmentId));
    },
    async abandon() {},
    async download() {
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
  <main>
    <Preview title="Staff images" canUpload attachments={[existing]} />
    <Preview title="Contestant images" canUpload={false} attachments={[{
      ...existing,
      id: "00000000-0000-4000-8000-000000000402",
      visibility: "public",
    }]} />
    <Preview title="Archived images" canUpload archived attachments={[existing]} />
  </main>,
);
