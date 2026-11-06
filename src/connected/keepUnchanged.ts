/**
 * Returns `next`, except that every array or object that holds the same data as
 * the one in `previous` is the previous object itself. A new snapshot then
 * keeps the identity of every issue that did not change, and a memoized row
 * that shows such an issue does not render again.
 *
 * Both values must be plain JSON data: objects, arrays, strings, numbers,
 * booleans and null. Neither argument is modified.
 */
export function keepUnchanged<T>(previous: unknown, next: T): T {
  if (previous === next) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    // Rows with an id keep their identity when others are added or removed.
    const byId = new Map<unknown, unknown>();
    for (const item of previous) {
      if (hasId(item)) byId.set(item.id, item);
    }
    const kept = next.map((item: unknown, index) =>
      keepUnchanged(hasId(item) ? byId.get(item.id) : previous[index], item),
    );
    const same =
      kept.length === previous.length &&
      kept.every((item, index) => item === previous[index]);
    return (same ? previous : kept) as T;
  }
  if (next !== null && typeof next === "object") {
    if (previous === null || typeof previous !== "object" || Array.isArray(previous)) {
      return next;
    }
    const before = previous as Record<string, unknown>;
    const entries = Object.entries(next as Record<string, unknown>).map(
      ([key, value]) => [key, keepUnchanged(before[key], value)] as const,
    );
    const same =
      entries.length === Object.keys(before).length &&
      entries.every(([key, value]) => before[key] === value);
    return (same ? previous : Object.fromEntries(entries)) as T;
  }
  return next;
}

function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}
