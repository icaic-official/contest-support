import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { backend } from "@/backend";
import { errorMessage } from "@/backend/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArchiveProgress } from "./buildContestArchive";
import type { ImageEntry } from "./contestArchive";
import type { ContestRecord } from "./contestRecord";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

function progressText({ stage, done, total }: ArchiveProgress): string {
  return stage === "images" && total > 0 ? `Downloading images ${done} of ${total}.` : "Building the zip file.";
}

function missingText(count: number): string {
  return `${count} ${count === 1 ? "image" : "images"} could not be added. README.txt in the archive lists them.`;
}

/** Reads an image through the same access-checked routes that the issue and announcement screens use. */
function fetchImage(record: ContestRecord, entry: ImageEntry): Promise<Blob> {
  if (entry.source === "issue") return backend.images.download(entry.key);
  const image = record.announcement_images.find((item) => item.id === entry.imageId);
  if (!image) return Promise.reject(new Error("This announcement image is not in the record."));
  return backend.announcements.downloadImage({
    id: image.id,
    session_id: record.contest.id,
    announcement_id: image.announcement_id,
  });
}

/** Hands the file to the browser. The link lives long enough for a large download to start. */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Downloads one zip of a contest's support record and its images. The server
 * only serves the record and the images. This browser builds the zip, so a
 * large contest costs the Worker no CPU. The button stays enabled while it runs,
 * so its focus stays, and a second click does nothing. It also works in an
 * archived event, because it only reads.
 */
export function ContestArchiveButton({
  contestId,
  contestName,
  className,
}: {
  contestId: string;
  contestName: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const running = useRef(false);
  const busy = status.kind === "busy";

  async function download() {
    if (running.current) return;
    running.current = true;
    setStatus({ kind: "busy", text: "Reading the contest record." });
    try {
      // The builder and the zip library load on the first click, so no console screen carries them.
      const [record, { buildContestArchive }] = await Promise.all([
        backend.manage.contestRecord(contestId),
        import("./buildContestArchive"),
      ]);
      const built = await buildContestArchive(
        record,
        (entry) => fetchImage(record, entry),
        (progress) => setStatus({ kind: "busy", text: progressText(progress) }),
      );
      save(built.blob, built.fileName);
      setStatus({
        kind: "done",
        text: built.missing.length > 0 ? `Archive downloaded. ${missingText(built.missing.length)}` : "Archive downloaded.",
      });
    } catch (cause) {
      setStatus({ kind: "failed", text: `The archive could not be built. ${errorMessage(cause)}` });
    } finally {
      running.current = false;
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1.5", className)}>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        loading={busy}
        aria-label={`Download archive of ${contestName}`}
        onClick={() => void download()}
      >
        <Download aria-hidden="true" />
        Download archive
      </Button>
      <p role="status" className="max-w-full text-xs break-words text-muted-foreground empty:hidden">
        {status.kind === "busy" || status.kind === "done" ? status.text : ""}
      </p>
      {status.kind === "failed" && (
        <p role="alert" className="max-w-full text-sm break-words text-destructive">
          {status.text}
        </p>
      )}
    </div>
  );
}
