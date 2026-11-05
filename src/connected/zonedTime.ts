/**
 * Event-zone time for the browser. The server stores instants only (UTC text).
 * Everything here is pure and uses Intl only, so it needs no date library.
 */

type Style = "time" | "date" | "datetime";

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of an instant in a zone, as the same fields in UTC milliseconds. */
function wallAsUtc(ms: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(ms)) parts[part.type] = Number(part.value);
  const at = (type: string) => parts[type] ?? 0;
  return Date.UTC(at("year"), at("month") - 1, at("day"), at("hour"), at("minute"), at("second"));
}

/** The zone's offset from UTC at an instant, in milliseconds. East is positive. */
function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(whole, timeZone) - whole;
}

const day = 86_400_000;

/**
 * Converts a wall time in a zone to an instant (an ISO string in UTC). A time
 * that the zone skips, such as 02:30 on the day clocks move forward, takes the
 * offset from before the change, which moves it forward. A time that occurs
 * twice takes the earlier instant. Returns undefined for text that is not a
 * date (`YYYY-MM-DD`) and a time (`HH:MM`).
 */
export function zonedWallTime(date: string, time: string, timeZone: string): string | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return undefined;
  const [year = 0, month = 0, dayOfMonth = 0, hour = 0, minute = 0] = [...d.slice(1), ...t.slice(1)].map(Number);
  const wall = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth || hour > 23 || minute > 59) return undefined;
  const before = offsetAt(wall - day, timeZone);
  const after = offsetAt(wall + day, timeZone);
  const valid = [...new Set([before, after])].map((offset) => wall - offset).filter((ms) => offsetAt(ms, timeZone) === wall - ms);
  const ms = valid.length > 0 ? Math.min(...valid) : wall - before;
  return new Date(ms).toISOString();
}

/** The date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant in a zone. For form defaults and grouping by day. */
export function zonedParts(instant: string, timeZone: string): { date: string; time: string } {
  const iso = new Date(wallAsUtc(Date.parse(instant), timeZone)).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const options: Record<Style, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  date: { weekday: "short", day: "numeric", month: "short" },
  datetime: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
};

/** Formats an instant in a zone, for example `13:00`, `Tue 3 Nov`, or `Tue 3 Nov, 13:00`. */
export function formatInZone(instant: string, timeZone: string, style: Style): string {
  return new Intl.DateTimeFormat(undefined, { ...options[style], timeZone }).format(Date.parse(instant));
}

/** The zone name of the viewer's device. */
export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The same instant in the viewer's zone, for example `Your time: 06:00`.
 * Undefined when the viewer's zone shows the same wall time as the event zone,
 * so a local viewer sees no extra text.
 */
export function viewerNote(instant: string, eventZone: string, style: Style = "time", zone = viewerZone()): string | undefined {
  const ms = Date.parse(instant);
  if (offsetAt(ms, zone) === offsetAt(ms, eventZone)) return undefined;
  return `Your time: ${formatInZone(instant, zone, style)}`;
}

/** A short zone label such as `GMT+8`, for the form that takes event-zone times. */
export function zoneLabel(timeZone: string, at = Date.now()): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" })
    .formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/** Whole minutes between two instants, rounded up, never below zero. */
export function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.ceil((to - from) / 60_000));
}

/** `1:42:10` for a span in milliseconds. Hours show only when needed. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
