import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Megaphone,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { backend } from "@/backend";
import { AnnouncementRejectedError, errorMessage } from "@/backend/errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnnouncementDraft,
  announcementCommand,
  draftOf,
  draftProblem,
  editReview,
  emptyAnnouncementDraft,
} from "./announcementForm";
import {
  ANNOUNCEMENT_DETAILS_MAX,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
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
import { checkImageFile } from "./imageCheck";
import { megabytes } from "./imageFile";
import { formatDate } from "./labels";

const VISIBLE_ANNOUNCEMENTS = 2;

/** `unknown` keeps the request ID for Retry. */
type Outcome = "done" | "rejected" | "unknown";

/** An open edit. `base` is the revision that the draft starts from. */
interface Edit {
  id: string;
  base: number;
  draft: AnnouncementDraft;
}

/**
 * Runs one announcement command at a time. A lost response keeps the request
 * ID, so Retry cannot publish twice. A confirmed rejection clears it.
 */
function useAnnouncementCommand(list: AnnouncementData) {
  const [running, setRunning] = useState<AnnouncementCommand>();
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<{ requestId: string; command: AnnouncementCommand }>(undefined);

  async function run(command: AnnouncementCommand): Promise<Outcome> {
    const previous = pending.current;
    const requestId =
      previous && JSON.stringify(previous.command) === JSON.stringify(command)
        ? previous.requestId
        : crypto.randomUUID();
    pending.current = { requestId, command };
    setRunning(command);
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
        if (cause.conflict) await list.refresh();
        return "rejected";
      }
      setRetryable(true);
      setError("The announcement may not have saved. Retry the same request.");
      return "unknown";
    } finally {
      setRunning(undefined);
    }
  }

  return {
    busy: running !== undefined,
    running,
    error,
    retryable,
    run,
    retry: () => (pending.current ? run(pending.current.command) : undefined),
  };
}

/**
 * The announcement IDs that were present when the viewer hid the strip, kept
 * per person and session in this browser. `undefined` means the strip is not
 * hidden. Anything stored that is not a list of IDs counts as not hidden.
 */
function useSeenAnnouncements(key: string) {
  const [state, setState] = useState(() => ({ key, seen: storedSeen(key) }));
  // A person or session change reads that key's choice before this render commits.
  if (state.key !== key) setState({ key, seen: storedSeen(key) });

  function setSeen(seen: ReadonlySet<string> | undefined) {
    setState({ key, seen });
    try {
      if (seen) window.localStorage.setItem(key, JSON.stringify([...seen]));
      else window.localStorage.removeItem(key);
    } catch {
      // The choice still applies until the page reloads.
    }
  }

  return [state.seen, setSeen] as const;
}

function storedSeen(key: string): ReadonlySet<string> | undefined {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return Array.isArray(stored) && stored.every((id) => typeof id === "string")
      ? new Set<string>(stored)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Active announcements above the workspace. Titles expand to plain-text
 * details and private images. Admins and jury also publish, edit, and remove.
 * Reading never waits for issue data, and failures never disable reporting.
 * The strip lists the newest announcements first. Any viewer can show the rest
 * or hide the strip until an announcement they have not seen arrives.
 */
export function Announcements({ data }: { data: SessionData }) {
  const member = data.snapshot?.membership;
  const manager = member ? canManageAnnouncements(member) : false;
  const archived = Boolean(data.snapshot?.event?.archived);
  const list = useAnnouncements(data, manager);
  const command = useAnnouncementCommand(list);
  const now = useNow(data.clockOffset);
  const headingId = useId();
  const bodyId = useId();
  const [seen, setSeen] = useSeenAnnouncements(
    `minsky:announcements-hidden:${member?.user_id ?? ""}:${data.sessionId}`,
  );
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [newDraft, setNewDraft] = useState(emptyAnnouncementDraft);
  const [edit, setEdit] = useState<Edit>();
  const [removing, setRemoving] = useState<string>();
  const newButton = useRef<HTMLButtonElement>(null);
  const removedId = useRef<string>(undefined);
  // The removed item takes its focused button with it. A live read can still
  // list it when the command returns, and New announcement stays disabled while
  // the command runs. So move focus once both have passed.
  useEffect(() => {
    if (command.busy || !removedId.current) return;
    if (list.announcements.some((item) => item.id === removedId.current)) return;
    removedId.current = undefined;
    newButton.current?.focus();
  }, [list.announcements, command.busy]);

  if (!member) return null;
  const canWrite = manager && !archived;
  const items = list.announcements.filter(
    (item) => manager || announcementStatus(item, now) === "Active",
  );
  // Readers see nothing until there is something to read. Failures stay quiet
  // for them, because issue work continues without announcements.
  if (!manager && items.length === 0) return null;
  // A new announcement is not in `seen`, so it shows the strip again. An edit keeps its ID.
  const [latest] = items;
  const hidden =
    seen !== undefined && latest !== undefined && items.every((item) => seen.has(item.id));
  // An open edit or removal prompt stays in view when a live change pushes it down.
  const pinned =
    items.findIndex((item) => item.id === edit?.id || item.id === removing) >=
    VISIBLE_ANNOUNCEMENTS;
  const shown = showAll || pinned ? items : items.slice(0, VISIBLE_ANNOUNCEMENTS);
  // Another manager can remove the announcement under an open edit. Its draft stays readable.
  const removedEdit =
    edit && list.loaded && !items.some((item) => item.id === edit.id) ? edit : undefined;

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
    removedId.current = item.id;
    const outcome = await command.run({
      type: "remove",
      id: item.id,
      revision: item.revision,
    });
    if (outcome !== "done") removedId.current = undefined;
    if (outcome !== "unknown") setRemoving(undefined);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-announcements=""
      // Reading keeps the queue in view. An open form needs room for all its controls.
      // Below the desktop breakpoint every button is 44 px high, so a thumb can hit it.
      className={`${composing || edit ? "max-h-[80dvh]" : "max-h-[40dvh]"} shrink-0 overflow-y-auto border-b bg-muted/40 max-lg:**:data-[slot=button]:h-11`}
    >
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-2 px-4 py-2 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Megaphone aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2 id={headingId} className="min-w-0 flex-1 truncate text-sm font-medium">
            Announcements
            {hidden && (
              <>
                {" "}
                <span className="ml-1.5 font-normal text-muted-foreground">{latest.title}</span>
              </>
            )}
          </h2>
          {canWrite && !hidden && (
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
          {items.length > 0 && (
            // One button for both states keeps keyboard focus on it.
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              aria-expanded={!hidden}
              aria-controls={bodyId}
              onClick={() =>
                setSeen(hidden ? undefined : new Set(items.map((item) => item.id)))
              }
            >
              {hidden ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
              {hidden ? "Show" : "Hide"}
              <span className="sr-only"> announcements</span>
            </Button>
          )}
        </div>
        {/* A failed publish may be unconfirmed, so its Retry stays reachable while hidden. */}
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
        {/* Hiding keeps the body mounted, so open items, drafts, and uploads survive Show. */}
        <div id={bodyId} hidden={hidden} className="grid gap-2">
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
          {manager && !list.loaded && !list.error && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading announcements…
            </p>
          )}
          {composing && canWrite && (
            <AnnouncementForm
              legend="New announcement"
              submitLabel="Publish"
              draft={newDraft}
              onDraft={setNewDraft}
              now={now}
              busy={command.busy}
              saving={command.running?.type === "publish"}
              onSubmit={() => void publish()}
              onCancel={() => setComposing(false)}
            />
          )}
          {removedEdit && canWrite && (
            <div className="rounded-lg border bg-card p-3 text-sm">
              <EditPanel
                edit={removedEdit}
                now={now}
                busy={command.busy}
                saving={false}
                onChange={setEdit}
                onSave={(current) => void save(current)}
                onCancel={() => setEdit(undefined)}
              />
            </div>
          )}
          {manager && list.loaded && items.length === 0 && !list.error && (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          )}
          <ul className="grid gap-1">
            {shown.map((item) => (
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
                running={command.running}
                editing={edit?.id === item.id ? edit : undefined}
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
          {items.length > VISIBLE_ANNOUNCEMENTS && !pinned && (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "Show fewer" : `Show ${items.length - VISIBLE_ANNOUNCEMENTS} more`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Focus for an inline confirmation. Opening it shows the whole prompt in the
 * scrolling strip and focuses its safe choice. When the closed prompt took
 * focus with it, focus returns to the control that opened it. Focus that has
 * moved elsewhere, for example into another prompt, stays there.
 */
function useConfirmFocus(confirming: boolean) {
  const trigger = useRef<HTMLButtonElement>(null);
  const prompt = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) {
      prompt.current?.scrollIntoView({ block: "nearest" });
      keep.current?.focus({ preventScroll: true });
    } else if (wasConfirming.current && document.activeElement === document.body) {
      trigger.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);
  return { trigger, prompt, keep };
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
  /** The command that runs now, so only its own control shows a spinner. */
  running: AnnouncementCommand | undefined;
  editing: Edit | undefined;
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
  const { item, expanded, manager, canWrite, now, busy, running, editing, removing } = props;
  const runsHere =
    running !== undefined && "id" in running && running.id === item.id;
  const panelId = useId();
  const warningId = useId();
  const { trigger: removeButton, prompt, keep: keepButton } = useConfirmFocus(removing);
  const status = announcementStatus(item, now);
  return (
    <li className="rounded-lg border bg-card">
      <h3 className="text-sm">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-lg:min-h-11"
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
              <time dateTime={item.published_at}>{formatDate(item.published_at)}</time>
              {item.edited_at && item.edited_name && (
                <>
                  . Last changed by {item.edited_name}{" "}
                  <time dateTime={item.edited_at}>{formatDate(item.edited_at)}</time>
                </>
              )}
              {item.expires_at && (
                <>
                  . {status === "Expired" ? "Expired" : "Expires"}{" "}
                  <time dateTime={item.expires_at}>{formatDate(item.expires_at)}</time>
                </>
              )}
            </p>
            <AnnouncementImages
              announcement={item}
              images={props.images}
              canAdd={canWrite}
              canRemove={canWrite}
              list={props.list}
            />
            {canWrite && !editing && !removing && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={props.onEdit}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  ref={removeButton}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={props.onAskRemove}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              </div>
            )}
            {canWrite && !editing && removing && (
              <div
                ref={prompt}
                role="group"
                aria-labelledby={warningId}
                className="grid gap-2 rounded-md border border-destructive/50 bg-background p-3"
              >
                <p id={warningId} className="font-medium">
                  Remove this announcement? It leaves the announcement strip for everyone,
                  managers included. Minsky keeps the record for the contest log.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    loading={runsHere && running.type === "remove"}
                    aria-describedby={warningId}
                    onClick={props.onRemove}
                  >
                    Remove announcement
                  </Button>
                  <Button ref={keepButton} size="sm" variant="ghost" onClick={props.onCancelRemove}>
                    Keep announcement
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {editing && canWrite && (
          <EditPanel
            edit={editing}
            latest={item}
            now={now}
            busy={busy}
            saving={runsHere && running.type === "edit"}
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
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  edit: Edit;
  latest?: Announcement;
  now: number;
  busy: boolean;
  saving: boolean;
  onChange: (edit: Edit) => void;
  onSave: (edit: Edit) => void;
  onCancel: () => void;
}) {
  const review = editReview(edit.base, latest);
  const reviewing = review !== "current";
  return (
    <div className="grid gap-3">
      {review === "review" && latest && (
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
                {latest.edited_at && <> {formatDate(latest.edited_at)}</>}
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
          Another manager removed this announcement. Your draft is kept, but it cannot be saved.
        </p>
      )}
      <AnnouncementForm
        legend="Edit announcement"
        submitLabel="Save changes"
        draft={edit.draft}
        onDraft={(draft) => onChange({ ...edit, draft })}
        now={now}
        busy={busy}
        saving={saving}
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
  saving,
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
  /** True while this form's own command runs. */
  saving: boolean;
  /** True while a review or a removal prevents saving. */
  blocked?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [touched, setTouched] = useState(false);
  const problem = draftProblem(draft, now);
  // The strip scrolls on its own, so bring the whole form, buttons included, into view once.
  useEffect(() => {
    form.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <form
      ref={form}
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
        <Button type="submit" size="sm" disabled={busy || blocked} loading={saving}>
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
function useImageUrl(
  session_id: string,
  announcement_id: string,
  id: string,
): { url: string; failed: boolean } {
  const [state, setState] = useState({ url: "", failed: false });
  // A ready image never changes, so only its identity starts a download.
  useEffect(() => {
    let active = true;
    let created = "";
    backend
      .announcements.downloadImage({ session_id, announcement_id, id })
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
  }, [session_id, announcement_id, id]);
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
  onRemove: () => Promise<void>;
}) {
  const { url, failed } = useImageUrl(image.session_id, image.announcement_id, image.id);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const warningId = useId();
  const { trigger, prompt, keep } = useConfirmFocus(confirming);

  async function confirm() {
    setRemoving(true);
    await onRemove();
    setRemoving(false);
    setConfirming(false);
  }

  return (
    <li className="grid gap-1 rounded-md border bg-background p-2">
      {url ? (
        <img src={url} alt={image.name} className="max-h-60 w-full rounded bg-muted object-contain" />
      ) : (
        <span className="flex h-24 items-center justify-center gap-2 rounded bg-muted text-xs text-muted-foreground">
          {!failed && <Spinner className="size-3.5" />}
          {failed ? "This image could not be opened." : "Loading image…"}
        </span>
      )}
      <span className="break-words text-xs text-muted-foreground">
        {image.name}. Added by {image.uploader_name}{" "}
        <time dateTime={image.uploaded_at}>{formatDate(image.uploaded_at)}</time>
      </span>
      {confirming && canRemove ? (
        <div
          ref={prompt}
          role="group"
          aria-labelledby={warningId}
          className="grid gap-2 rounded-md border border-destructive/50 p-2"
        >
          <p id={warningId} className="text-xs font-medium break-words">
            Remove {image.name}? It leaves this announcement for everyone.
            Minsky deletes the file and cannot restore it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              loading={removing}
              aria-describedby={warningId}
              onClick={() => void confirm()}
            >
              Remove image
            </Button>
            <Button ref={keep} size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Keep image
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {url && (
            <Button asChild size="xs" variant="outline">
              <a href={url} download={image.name}>
                Download<span className="sr-only"> {image.name}</span>
              </a>
            </Button>
          )}
          {canRemove && (
            <Button
              ref={trigger}
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove<span className="sr-only"> {image.name}</span>
            </Button>
          )}
        </div>
      )}
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
      await backend.announcements.uploadImage({
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
    const problem = await checkImageFile(file, ANNOUNCEMENT_IMAGE_MAX_BYTES);
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
      await backend.announcements.removeImage(image.session_id, image.id);
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
              onRemove={() => remove(image)}
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
              ? `This announcement has ${ANNOUNCEMENT_IMAGE_MAX_COUNT} images. Remove one to add another.`
              : `JPEG, PNG, or WebP. Up to ${ANNOUNCEMENT_IMAGE_MAX_COUNT} images, ${megabytes(ANNOUNCEMENT_IMAGE_MAX_BYTES)} MB each.`}
          </p>
          {progress !== undefined && (
            <>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                Uploading image…
              </p>
              <progress className="w-full" max={100} value={progress} aria-label="Upload progress" />
            </>
          )}
          {retry && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              loading={progress !== undefined}
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
