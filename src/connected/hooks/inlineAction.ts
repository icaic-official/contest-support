/**
 * An inline Claim or Accept returns to the list when the person did not
 * choose an issue while the command ran.
 *
 * `markAtStart` and `markNow` count only choices the person made.
 * The selection a recorded command applies by itself does not move the mark.
 */
export function inlineActionReturnsToList(
  recorded: boolean,
  markAtStart: number,
  markNow: number,
): boolean {
  return recorded && markNow === markAtStart;
}
