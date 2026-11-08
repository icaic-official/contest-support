/**
 * Matches an address by its path and fragment, for `toHaveURL`. A person with
 * several contests also has `?contest=` in the address. This ignores that one
 * parameter and fails on any other.
 */
export function atPath(path: string): (url: URL) => boolean {
  const target = new URL(path, "http://app.invalid");
  return (url) =>
    url.pathname === target.pathname &&
    url.hash === target.hash &&
    [...url.searchParams.keys()].every((key) => key === "contest");
}
