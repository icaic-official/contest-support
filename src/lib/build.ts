/** The first characters of a commit hash. They are enough to tell builds apart. */
export function shortBuildId(id: string): string {
  return /^[0-9a-f]{40}$/.test(id) ? id.slice(0, 7) : id;
}
