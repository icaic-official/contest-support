import {
  ANNOUNCEMENT_DETAILS_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type Announcement,
  type AnnouncementCommand,
} from "./announcementModel";

/** The text a manager types. `expires` uses the local `datetime-local` format. */
export interface AnnouncementDraft {
  title: string;
  details: string;
  expires: string;
}

export const emptyAnnouncementDraft: AnnouncementDraft = {
  title: "",
  details: "",
  expires: "",
};

/** Formats an ISO time for a `datetime-local` field in the browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const time = new Date(iso);
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Returns an ISO time, null for no expiry, or undefined for an invalid value. */
export function expiryFromInput(value: string): string | null | undefined {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

export function draftOf(announcement: Announcement): AnnouncementDraft {
  return {
    title: announcement.title,
    details: announcement.details,
    expires: toLocalInput(announcement.expires_at),
  };
}

/** A plain-language problem, or undefined when the server can accept the draft. */
export function draftProblem(
  draft: AnnouncementDraft,
  now: number,
): string | undefined {
  const title = draft.title.trim();
  const details = draft.details.trim();
  if (!title || title.length > ANNOUNCEMENT_TITLE_MAX) {
    return `Enter a title of 1 to ${ANNOUNCEMENT_TITLE_MAX} characters.`;
  }
  if (!details || details.length > ANNOUNCEMENT_DETAILS_MAX) {
    return `Enter details of 1 to ${ANNOUNCEMENT_DETAILS_MAX.toLocaleString("en")} characters.`;
  }
  const expires = expiryFromInput(draft.expires);
  if (expires === undefined) return "Enter a valid expiry time.";
  if (expires !== null && Date.parse(expires) <= now) {
    return "Choose a future expiry time or no expiry.";
  }
  return undefined;
}

/** Builds a publish command, or an edit when `target` names the reviewed revision. */
export function announcementCommand(
  draft: AnnouncementDraft,
  target?: { id: string; revision: number },
): AnnouncementCommand {
  const fields = {
    title: draft.title.trim(),
    details: draft.details.trim(),
    expires_at: expiryFromInput(draft.expires) ?? null,
  };
  return target
    ? { type: "edit", ...target, ...fields }
    : { type: "publish", ...fields };
}

/**
 * How an open edit relates to the stored record. `current` means the draft
 * starts from the latest revision. `review` means another change arrived, so
 * the manager must choose a draft before saving. `removed` and `missing` keep
 * the draft but cannot save.
 */
export function editReview(
  baseRevision: number,
  latest: Announcement | undefined,
): "current" | "review" | "removed" | "missing" {
  if (!latest) return "missing";
  if (latest.removed_at) return "removed";
  return latest.revision === baseRevision ? "current" : "review";
}
