import {
  ChevronDown,
  CircleAlert,
  Megaphone,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { requireBackend } from "@/backend";
import { AnnouncementRejectedError, errorMessage } from "@/backend/errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnnouncementDraft,
  announcementCommand,
  draftOf,
  draftProblem,
  editReview,
  emptyAnnouncementDraft,
} from "./announcementForm";
import { checkAnnouncementImage } from "./announcementImage";
import {
  ANNOUNCEMENT_DETAILS_MAX,
  ANNOUNCEMENT_IMAGE_MAX_COUNT,
  ANNOUNCEMENT_TITLE_MAX,
  type Announcement,
  type AnnouncementCommand,
  type AnnouncementImage,
  announcementStatus,
  canManageAnnouncements,
} from "./announcementModel";
import { type AnnouncementData, useAnnouncements } from "./hooks/useAnnouncements";
import { useNow } from "./hooks/useNow";
import type { SessionData } from "./hooks/useSessionSnapshot";

type Outcome = "done" | "conflict" | "failed";

/** An open edit. `base` is the revision that the draft starts from. */
interface Edit {
  id: string;
  base: number;
  draft: AnnouncementDraft;
}

function time(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * Runs one announcement command at a time. A lost response keeps the request
 * ID, so Retry cannot publish twice. A confirmed rejection clears it.
 */
function useAnnouncementCommand(list: AnnouncementData) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<{ requestId: string; command: AnnouncementCommand }>(undefined);

  async function run(command: AnnouncementCommand): Promise<Outcome> {
    const same =
      pending.current &&
      JSON.stringify(pending.current.command) === JSON.stringify(command);
    const requestId = same ? pending.current!.requestId : crypto.randomUUID();
    pending.current = { requestId, command };
    setBusy(true);
    setError("");
    try {
      await list.execute(requestId, command);
      pending.current = undefined;
      setRetryable(false);
      return "done";
    } catch (cause) {
      if (cause instanceof AnnouncementRejectedError) {
        pending.current = undefined;
        setRetryable(false);
        setError(errorMessage(cause));
        if (cause.conflict) {
          await list.refresh();
          return "conflict";
        }
        return "failed";
      }
      setRetryable(true);
      setError("The announcement may not have saved. Retry the same request.");
      return "failed";
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    retryable,
    run,
    retry: () => (pending.current ? run(pending.current.command) : undefined),
    clearError: () => setError(""),
  };
}

/**
 * Active announcements above the workspace. Titles expand to plain-text
 * details and private images. Admins and jury also publish, edit, and remove.
 * Reading never waits for issue data, and failures never disable reporting.
 */
export function Announcements({ data }: { data: SessionData }) {
  const member = data.snapshot?.membership;
  const manager = member ? canManageAnnouncements(member) : false;
  const archived = Boolean(data.snapshot?.event?.archived);
  const list = useAnnouncements(data, manager);
  const command = useAnnouncementCommand(list);
  const now = useNow(data.clockOffset);
  const headingId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [newDraft, setNewDraft] = useState(emptyAnnouncementDraft);
  const [edit, setEdit] = useState<Edit>();
  const [removing, setRemoving] = useState<string>();
  const newButton = useRef<HTMLButtonElement>(null);

  if (!member) return null;
  const canWrite = manager && !archived;
  const items = list.announcements.filter(
    (item) =>
      manager ||
      (!item.removed_at && (!item.expires_at || Date.parse(item.expires_at) > now)),
  );
  // Readers see nothing until there is something to read. Failures stay quiet
  // for them, because issue work continues without announcements.
  if (!manager && items.length === 0) return null;

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function publish() {
    const outcome = await command.run(announcementCommand(newDraft));
    if (outcome === "done") {
      setNewDraft(emptyAnnouncementDraft);
      setComposing(false);
      window.requestAnimationFrame(() => newButton.current?.focus());
    }
  }

  async function save(current: Edit) {
    const outcome = await command.run(
      announcementCommand(current.draft, { id: current.id, revision: current.base }),
    );
    if (outcome === "done") setEdit(undefined);
  }

  async function remove(item: Announcement) {
    const outcome = await command.run({
      type: "remove",
      id: item.id,
      revision: item.revision,
    });
    if (outcome !== "failed" || !command.retryable) setRemoving(undefined);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="max-h-[40dvh] shrink-0 overflow-y-auto border-b bg-muted/40"
    >
      <div className="mx-auto grid max-w-4xl gap-2 px-4 py-2 sm:px-8">
        <div className="flex items-center gap-2">
          <Megaphone aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2 id={headingId} className="flex-1 text-sm font-medium">
            Announcements
          </h2>
          {canWrite && (
            <Button
              ref={newButton}
              size="sm"
              variant="outline"
              aria-expanded={composing}
              disabled={command.busy}
              onClick={() => setComposing((value) => !value)}
            >
              <Plus aria-hidden="true" />
              New announcement
            </Button>
          )}
        </div>
        {list.error && manager && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="flex items-center gap-3">
              <span className="flex-1">{list.error}</span>
              <Button size="sm" variant="outline" onClick={() => void list.refresh()}>
                <RotateCw aria-hidden="true" />
                Reload
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {command.error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="flex items-center gap-3">
              <span className="flex-1">{command.error}</span>
              {command.retryable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={command.busy}
                  onClick={() => void command.retry()}
                >
                  <RotateCw aria-hidden="true" />
                  Retry last request
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {composing && canWrite && (
          <AnnouncementForm
            legend="New announcement"
            submitLabel="Publish"
            draft={newDraft}
            onDraft={setNewDraft}
            now={now}
            busy={command.busy}
            onSubmit={() => void publish()}
            onCancel={() => setComposing(false)}
          />
        )}
        {manager && list.loaded && items.length === 0 && !list.error && (
          <p className="text-sm text-muted-foreground">No announcements yet.</p>
        )}
        <ul className="grid gap-1">
          {items.map((item) => (
            <AnnouncementItem
              key={item.id}
              item={item}
              images={list.images.filter((image) => image.announcement_id === item.id)}
              expanded={open.has(item.id)}
              onToggle={() => toggle(item.id)}
              manager={manager}
              canWrite={canWrite}
              now={now}
              busy={command.busy}
              editing={edit?.id === item.id ? edit : undefined}
              latest={item}
              removing={removing === item.id}
              onEdit={() => {
                setOpen((current) => new Set(current).add(item.id));
                setEdit({ id: item.id, base: item.revision, draft: draftOf(item) });
              }}
              onEditChange={setEdit}
              onSave={(current) => void save(current)}
              onCancelEdit={() => setEdit(undefined)}
              onAskRemove={() => setRemoving(item.id)}
              onCancelRemove={() => setRemoving(undefined)}
              onRemove={() => void remove(item)}
              list={list}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function AnnouncementItem(props: {
  item: Announcement;
  images: AnnouncementImage[];
  expanded: boolean;
  onToggle: () => void;
  manager: boolean;
  canWrite: boolean;
  now: number;
  busy: boolean;
  editing: Edit | undefined;
  latest: Announcement;
  removing: boolean;
  onEdit: () => void;
  onEditChange: (edit: Edit) => void;
  onSave: (edit: Edit) => void;
  onCancelEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  list: AnnouncementData;
}) {
  const { item, expanded, manager, canWrite, now, busy, editing } = props;
  const panelId = useId();
  const status = announcementStatus(item, now);
  const removed = status === "Removed";
  return (
    <li className="rounded-lg border bg-card">
      <h3 className="text-sm">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={props.onToggle}
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0 flex-1 break-words">{item.title}</span>
          {manager && (
            <Badge variant={status === "Active" ? "default" : "secondary"}>
              {status}
            </Badge>
          )}
        </button>
      </h3>
      <div id={panelId} hidden={!expanded} className="grid gap-3 px-3 pb-3 text-sm">
        {expanded && (
          <>
            <p className="break-words whitespace-pre-wrap">{item.details}</p>
            <p className="text-xs text-muted-foreground">
              Published by {item.author_name}{" "}
              <time dateTime={item.published_at}>{time(item.published_at)}</time>
              {item.edited_at && item.edited_name && (
                <>
                  . Last changed by {item.edited_name}{" "}
                  <time dateTime={item.edited_at}>{time(item.edited_at)}</time>
                </>
              )}
              {item.expires_at && (
                <>
                  . {status === "Expired" ? "Expired" : "Expires"}{" "}
                  <time dateTime={item.expires_at}>{time(item.expires_at)}</time>
                </>
              )}
              {item.removed_at && item.removed_name && (
                <>
                  . Removed by {item.removed_name}{" "}
                  <time dateTime={item.removed_at}>{time(item.removed_at)}</time>
                </>
              )}
            </p>
            <AnnouncementImages
              announcement={item}
              images={props.images}
              canAdd={canWrite && !removed}
              canRemove={canWrite}
              list={props.list}
            />
            {canWrite && !removed && !editing && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={props.onEdit}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                {props.removing ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={props.onRemove}
                    >
                      Confirm removal
                    </Button>
                    <Button size="sm" variant="ghost" onClick={props.onCancelRemove}>
                      Keep announcement
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={props.onAskRemove}>
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {editing && canWrite && (
          <EditPanel
            edit={editing}
            latest={props.latest}
            now={now}
            busy={busy}
            onChange={props.onEditChange}
            onSave={props.onSave}
            onCancel={props.onCancelEdit}
          />
        )}
      </div>
    </li>
  );
}

/**
 * An edit starts from one revision. When another change arrives, the manager
 * reviews the latest text and chooses whether to keep the draft or load the
 * latest. Another change before saving needs another review.
 */
function EditPanel({
  edit,
  latest,
  now,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  edit: Edit;
  latest: Announcement;
  now: number;
  busy: boolean;
  onChange: (edit: Edit) => void;
  onSave: (edit: Edit) => void;
  onCancel: () => void;
}) {
  const review = editReview(edit.base, latest);
  const reviewing = review !== "current";
  return (
    <div className="grid gap-3">
      {review === "review" && (
        <div role="group" aria-label="Review the latest version" className="grid gap-2 rounded-md border border-status-escalated/50 bg-muted p-3">
          <p className="font-medium">This announcement changed while you edited it.</p>
          <dl className="grid gap-1 text-xs">
            <div>
              <dt className="inline font-medium">Latest title: </dt>
              <dd className="inline break-words">{latest.title}</dd>
            </div>
            <div>
              <dt className="font-medium">Latest details</dt>
              <dd className="break-words whitespace-pre-wrap">{latest.details}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Changed by: </dt>
              <dd className="inline">
                {latest.edited_name ?? latest.author_name}
                {latest.edited_at && <> {time(latest.edited_at)}</>}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange({ ...edit, base: latest.revision })}
            >
              Keep my draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({ id: edit.id, base: latest.revision, draft: draftOf(latest) })
              }
            >
              Load latest text
            </Button>
          </div>
        </div>
      )}
      {review === "removed" && (
        <p role="alert" className="text-sm text-destructive">
          This announcement was removed. Your draft is kept, but it cannot be saved.
        </p>
      )}
      {review === "missing" && (
        <p role="alert" className="text-sm text-destructive">
          This announcement is no longer available. Your draft is kept, but it cannot be saved.
        </p>
      )}
      <AnnouncementForm
        legend="Edit announcement"
        submitLabel="Save changes"
        draft={edit.draft}
        onDraft={(draft) => onChange({ ...edit, draft })}
        now={now}
        busy={busy}
        blocked={reviewing}
        onSubmit={() => onSave(edit)}
        onCancel={onCancel}
      />
    </div>
  );
}

function AnnouncementForm({
  legend,
  submitLabel,
  draft,
  onDraft,
  now,
  busy,
  blocked = false,
  onSubmit,
  onCancel,
}: {
  legend: string;
  submitLabel: string;
  draft: AnnouncementDraft;
  onDraft: (draft: AnnouncementDraft) => void;
  now: number;
  busy: boolean;
  /** True while a review or a removal prevents saving. */
  blocked?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const problem = draftProblem(draft, now);
  return (
    <form
      className="grid gap-3 rounded-md border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!problem && !blocked) onSubmit();
      }}
    >
      <p className="font-medium">{legend}</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          value={draft.title}
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          onChange={(event) => onDraft({ ...draft, title: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-details`}>Details</Label>
        <Textarea
          id={`${id}-details`}
          rows={4}
          value={draft.details}
          maxLength={ANNOUNCEMENT_DETAILS_MAX}
          onChange={(event) => onDraft({ ...draft, details: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">Plain text. Line breaks are kept.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-expires`}>Expires (optional)</Label>
        <Input
          id={`${id}-expires`}
          type="datetime-local"
          value={draft.expires}
          onChange={(event) => onDraft({ ...draft, expires: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to keep it active until someone removes it.
        </p>
      </div>
      {touched && problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || blocked}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {legend === "New announcement" ? "Close" : "Cancel edit"}
        </Button>
      </div>
    </form>
  );
}

/** Loads one private image through the access-checked download. */
function useImageUrl(image: AnnouncementImage): { url: string; failed: boolean } {
  const [state, setState] = useState({ url: "", failed: false });
  useEffect(() => {
    let active = true;
    let created = "";
    requireBackend()
      .announcements.downloadImage(image)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (active) setState({ url: created, failed: false });
        else URL.revokeObjectURL(created);
      })
      .catch(() => {
        if (active) setState({ url: "", failed: true });
      });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
    // A ready image never changes, and each snapshot parses new objects. Only its identity starts a download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.session_id, image.announcement_id, image.id]);
  return state;
}

function AnnouncementImageView({
  image,
  canRemove,
  busy,
  onRemove,
}: {
  image: AnnouncementImage;
  canRemove: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const { url, failed } = useImageUrl(image);
  return (
    <li className="grid gap-1 rounded-md border bg-background p-2">
      {url ? (
        <img src={url} alt={image.name} className="max-h-60 w-full rounded bg-muted object-contain" />
      ) : (
        <span className="grid h-24 place-items-center rounded bg-muted text-xs text-muted-foreground">
          {failed ? "This image could not be opened." : "Loading image…"}
        </span>
      )}
      <span className="break-words text-xs text-muted-foreground">
        {image.name}. Added by {image.uploader_name}{" "}
        <time dateTime={image.uploaded_at}>{time(image.uploaded_at)}</time>
      </span>
      <div className="flex flex-wrap gap-2">
        {url && (
          <Button asChild size="xs" variant="outline">
            <a href={url} download={image.name}>
              Download<span className="sr-only"> {image.name}</span>
            </a>
          </Button>
        )}
        {canRemove && (
          <Button size="xs" variant="outline" disabled={busy} onClick={onRemove}>
            Remove<span className="sr-only"> {image.name}</span>
          </Button>
        )}
      </div>
    </li>
  );
}

/** A failed upload keeps its file and request ID, so Retry cannot add a second image. */
function AnnouncementImages({
  announcement,
  images,
  canAdd,
  canRemove,
  list,
}: {
  announcement: Announcement;
  images: AnnouncementImage[];
  canAdd: boolean;
  canRemove: boolean;
  list: AnnouncementData;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<{ file: File; requestId: string }>();

  async function upload(file: File, requestId: string) {
    setBusy(true);
    setMessage("");
    setProgress(0);
    try {
      await requireBackend().announcements.uploadImage({
        sessionId: announcement.session_id,
        announcementId: announcement.id,
        requestId,
        file,
        onProgress: setProgress,
      });
      setRetry(undefined);
      if (input.current) input.current.value = "";
    } catch (cause) {
      // The published text stays available. Retry reuses this request ID.
      setRetry({ file, requestId });
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
      setProgress(undefined);
      await list.refresh();
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setRetry(undefined);
    const problem = await checkAnnouncementImage(file);
    if (problem) {
      setMessage(problem);
      if (input.current) input.current.value = "";
      return;
    }
    await upload(file, crypto.randomUUID());
  }

  async function remove(image: AnnouncementImage) {
    setBusy(true);
    setMessage("");
    try {
      await requireBackend().announcements.removeImage(image.session_id, image.id);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
      await list.refresh();
    }
  }

  const full = images.length >= ANNOUNCEMENT_IMAGE_MAX_COUNT;
  if (!images.length && !canAdd) return null;
  return (
    <div className="grid gap-2">
      <h4 className="text-xs font-medium">Images ({images.length})</h4>
      {images.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {images.map((image) => (
            <AnnouncementImageView
              key={image.id}
              image={image}
              canRemove={canRemove}
              busy={busy}
              onRemove={() => void remove(image)}
            />
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="grid gap-1.5">
          <Label htmlFor={inputId}>Add an image</Label>
          <Input
            ref={input}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || full}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <p className="text-xs text-muted-foreground">
            {full
              ? "This announcement has four images. Remove one to add another."
              : "JPEG, PNG, or WebP. Up to 4 images, 10 MB each."}
          </p>
          {progress !== undefined && (
            <progress className="w-full" max={100} value={progress} aria-label="Upload progress" />
          )}
          {retry && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={() => void upload(retry.file, retry.requestId)}
            >
              <RotateCw aria-hidden="true" />
              Retry upload
            </Button>
          )}
        </div>
      )}
      <p role="status" className="text-xs text-destructive empty:hidden">
        {message}
      </p>
    </div>
  );
}
