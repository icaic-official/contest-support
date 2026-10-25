import { useId, useRef } from "react";
import { Camera, Download, Eye, ImageOff, Lock, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  type IssueImagesState,
  useIssueImages,
} from "@/connected/hooks/useIssueImages";
import type { ImageTransport } from "@/backend/contracts";
import type { Snapshot } from "@/connected/model";
import { cn } from "@/lib/utils";
import { ActionDialog } from "./ActionDialog";
import { ActionSheet } from "./ActionSheet";

function uploadedText(item: { uploader_name: string; uploaded_at: string }) {
  return `Image uploaded by ${item.uploader_name} on ${new Date(item.uploaded_at).toLocaleString()}`;
}

/**
 * Thumbnails of the issue images that this person can see, and a camera tile
 * that starts an upload. Each thumbnail opens the preview.
 */
export function ImageGallery({
  images,
  maxImages,
  onAdd,
}: {
  images: IssueImagesState;
  maxImages: number;
  /** Opens the upload form. Omit it when the person cannot upload. */
  onAdd?: () => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.shown.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={`View ${uploadedText(item).toLowerCase()}`}
          onClick={() => void images.openPreview(item)}
          className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {images.thumbs[item.id] ? (
            <img
              src={images.thumbs[item.id]}
              alt=""
              className="size-full object-cover"
            />
          ) : images.thumbs[item.id] === undefined ? (
            <Spinner className="size-5 text-muted-foreground" />
          ) : (
            <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />
          )}
          <span
            className={cn(
              "absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-medium",
              item.visibility === "internal"
                ? "bg-amber-500 text-white"
                : "bg-background/90",
            )}
          >
            {item.visibility === "internal" ? (
              <Lock aria-hidden="true" className="size-2.5" />
            ) : (
              <Eye aria-hidden="true" className="size-2.5" />
            )}
            {item.visibility === "internal" ? "Staff" : "Team"}
          </span>
        </button>
      ))}
      {onAdd && images.shown.length < maxImages && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add an image"
          className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Camera aria-hidden="true" className="size-5" />
        </button>
      )}
    </div>
  );
}

/**
 * Uploads one image. The person chooses who can see it before the upload,
 * and the choice stays fixed. Staff only is the default. A failed upload
 * keeps its file, request and visibility until the person retries or
 * cancels it.
 */
export function ImageUploadForm({ images }: { images: IssueImagesState }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { retry, busy, visibility } = images;
  const locked = busy || Boolean(retry);
  async function submit() {
    const file = retry?.file ?? fileRef.current?.files?.[0];
    if (!file || file.size === 0) {
      images.setMessage("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (await images.send(file) && fileRef.current) fileRef.current.value = "";
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={locked}>
        <legend className="pb-2 text-sm font-medium">
          Who can see this image
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["internal", "Staff only", "Default", Lock],
              ["public", "Visible to the team", "Shown to the team", Eye],
            ] as const
          ).map(([value, label, help, Icon]) => (
            <label
              key={value}
              className="cursor-pointer rounded-xl border p-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input
                type="radio"
                name={`${id}-visibility`}
                value={value}
                checked={visibility === value}
                onChange={() => images.setVisibility(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-4" />
              <span className="mt-1.5 block font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        You cannot change this choice after the upload.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-file`} className="text-sm font-medium">
          Image file
        </label>
        <input
          id={`${id}-file`}
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={locked}
          aria-describedby={`${id}-limits`}
          onChange={() => {
            images.clearRetry();
            images.setMessage("");
          }}
          className="block w-full text-sm file:mr-3 file:h-11 file:rounded-md file:border file:bg-background file:px-3 file:text-sm file:font-medium"
        />
        <p id={`${id}-limits`} className="text-xs text-muted-foreground">
          {images.limitText}
        </p>
      </div>
      {images.progress !== undefined && (
        <div className="space-y-1">
          <p id={`${id}-progress`} className="flex items-center gap-2 text-sm">
            <Spinner className="size-4" />
            Uploading image, {images.progress}%.
          </p>
          <progress
            aria-labelledby={`${id}-progress`}
            value={images.progress}
            max={100}
            className="h-2 w-full accent-current"
          />
        </div>
      )}
      {retry && (
        <p className="text-xs text-muted-foreground">
          The visibility choice stays fixed for this upload. Cancel the upload
          to change it.
        </p>
      )}
      {images.message && (
        <p role="status" className="text-sm">
          {images.message}
        </p>
      )}
      {!retry && (
        <Button
          type="submit"
          className="h-11 w-full"
          disabled={busy}
          loading={images.progress !== undefined}
        >
          <Camera aria-hidden="true" />
          Add image
        </Button>
      )}
      {retry && !retry.cleanupOnly && (
        <Button
          type="submit"
          className="h-11 w-full"
          disabled={busy}
          loading={images.progress !== undefined}
        >
          Try the upload again
        </Button>
      )}
      {retry && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => {
            void images.cancelUpload().then((canceled) => {
              if (canceled && fileRef.current) fileRef.current.value = "";
            });
          }}
        >
          Cancel upload
        </Button>
      )}
    </form>
  );
}

/**
 * The full image with Download, Remove (the uploader only, while the event is
 * active) and Close.
 */
export function ImagePreviewDialog({
  images,
  userId,
  archived,
}: {
  images: IssueImagesState;
  userId: string;
  archived: boolean;
}) {
  const { active, fullUrl } = images;
  return (
    <Dialog
      open={Boolean(active)}
      onOpenChange={(open) => {
        if (!open) images.closePreview();
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto p-4" showCloseButton={false}>
        {active && (
          <>
            <DialogTitle className="pr-8 text-base">
              {uploadedText(active)}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              {active.visibility === "internal" ? (
                <>
                  <Lock aria-hidden="true" className="size-3.5" />
                  Staff only
                </>
              ) : (
                <>
                  <Eye aria-hidden="true" className="size-3.5" />
                  Visible to the team
                </>
              )}
            </DialogDescription>
            {fullUrl ? (
              <img
                src={fullUrl}
                alt={uploadedText(active)}
                className="max-h-[60dvh] w-full rounded-lg object-contain"
              />
            ) : (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Opening image.
              </p>
            )}
            <div className="grid gap-2">
              {fullUrl && (
                <Button asChild variant="outline" className="h-11">
                  <a href={fullUrl} download={active.original_name}>
                    <Download aria-hidden="true" />
                    Download image
                  </a>
                </Button>
              )}
              {active.uploader === userId && !archived && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 text-destructive"
                  disabled={images.busy}
                  onClick={() => void images.remove(active)}
                >
                  <Trash2 aria-hidden="true" />
                  Remove image
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={images.closePreview}
              >
                <X aria-hidden="true" />
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The images of one issue for organisers: the gallery, the preview, an upload
 * sheet and retries for removals that did not finish. The desktop console
 * sets `surface="dialog"` to show the upload form in a dialog.
 */
export function OrganiserImages({
  state,
  issueId,
  userId,
  canUpload,
  uploadOpen,
  onUploadOpenChange,
  onChanged,
  transport,
  surface = "sheet",
}: {
  state: Snapshot;
  issueId: string;
  userId: string;
  canUpload: boolean;
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
  transport?: ImageTransport;
  surface?: "sheet" | "dialog";
}) {
  const Surface = surface === "dialog" ? ActionDialog : ActionSheet;
  const session = state.session;
  const archived = Boolean(state.event?.archived);
  const images = useIssueImages({
    sessionId: session?.id ?? "",
    issueId,
    staff: true,
    limits: {
      maxImageBytes: session?.max_image_bytes ?? 0,
      maxImages: session?.max_images_per_issue ?? 0,
      maxTotalBytes: session?.max_image_bytes_per_issue ?? 0,
    },
    attachments: state.attachments.filter((item) => item.issue_id === issueId),
    pendingRemovals: state.pending_removals.filter(
      (item) => item.issue_id === issueId,
    ),
    onChanged,
    transport,
  });
  const maxImages = session?.max_images_per_issue ?? 0;
  return (
    <section aria-labelledby={`images-${issueId}`}>
      <h2
        id={`images-${issueId}`}
        className="pb-2 text-xs font-medium text-muted-foreground"
      >
        Images · {images.shown.length} of {maxImages}
      </h2>
      {images.shown.length === 0 && !canUpload && (
        <p className="text-sm text-muted-foreground">No images attached.</p>
      )}
      <ImageGallery
        images={images}
        maxImages={maxImages}
        onAdd={canUpload ? () => onUploadOpenChange(true) : undefined}
      />
      {archived && (
        <p className="mt-1 text-xs text-muted-foreground">
          This event is archived. Images cannot be added.
        </p>
      )}
      {images.removals.map((item) => (
        <Alert key={item.id} className="mt-2">
          <AlertDescription className="gap-2">
            <p>The files for {item.original_name} still need to be deleted.</p>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={images.busy}
              onClick={() => void images.remove(item)}
            >
              Retry removal
            </Button>
          </AlertDescription>
        </Alert>
      ))}
      {images.message && !uploadOpen && (
        <p role="status" className="mt-2 text-sm">
          {images.message}
        </p>
      )}
      <ImagePreviewDialog images={images} userId={userId} archived={archived} />
      {canUpload && (
        <Surface
          open={uploadOpen}
          onOpenChange={onUploadOpenChange}
          title="Add an image"
          description="Choose who can see it. You cannot change this later."
        >
          <ImageUploadForm images={images} />
        </Surface>
      )}
    </section>
  );
}
