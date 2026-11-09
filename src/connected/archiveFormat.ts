import { zonedParts } from "./zonedTime.ts";

/** Text rules that the contest archive files share. Nothing here depends on the device's locale. */

/** An instant as event-zone wall time plus UTC ISO, for example `2026-11-03 13:00 Asia/Singapore (2026-11-03T05:00:00.000Z)`. */
export function stampText(instant: string, timeZone: string): string {
  const { date, time } = zonedParts(instant, timeZone);
  return `${date} ${time} ${timeZone} (${new Date(instant).toISOString()})`;
}

/** The event-zone date as `YYYYMMDD`. */
export function compactDate(instant: string, timeZone: string): string {
  return zonedParts(instant, timeZone).date.replaceAll("-", "");
}

export type AwardState = "withdrawn" | "applied" | "pending";

/** A withdrawn award gives no time, even if staff confirmed it before. */
export function awardState(award: { applied_at: string | null; withdrawn_at: string | null }): AwardState {
  if (award.withdrawn_at) return "withdrawn";
  return award.applied_at ? "applied" : "pending";
}

const MAX_NAME_LENGTH = 80;
// Control characters and invisible format characters, such as zero-width spaces and bidirectional overrides, which hide what a name says.
const invisible = /[\p{Cc}\p{Cf}]/gu;

/**
 * A file name that is safe on Windows, macOS, and Linux and cannot leave its
 * folder. It drops control characters, replaces path separators and the
 * characters that Windows refuses, removes `..`, leading dots, and trailing
 * dots and spaces, and caps the length but keeps a short extension.
 */
export function safeName(name: string, fallback = "file"): string {
  const cleaned = name
    .replace(invisible, "")
    .replace(/[\\/<>:"|?*]/gu, "_")
    .replace(/\.{2,}/gu, ".")
    .trim()
    .replace(/^[. ]+/u, "")
    .replace(/[. ]+$/u, "");
  const characters = Array.from(cleaned);
  if (characters.length <= MAX_NAME_LENGTH) return cleaned || fallback;
  const extension = /\.[\p{L}\p{N}]{1,8}$/u.exec(cleaned)?.[0] ?? "";
  const kept = characters.slice(0, MAX_NAME_LENGTH - Array.from(extension).length).join("").replace(/[. ]+$/u, "");
  return `${kept}${extension}` || fallback;
}

/** Lowercase letters, digits, and single hyphens, for the name of a folder. */
export function slug(text: string, fallback: string, maxLength = 40): string {
  const value = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maxLength)
    .replace(/-+$/u, "");
  return value || fallback;
}
