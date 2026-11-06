/** Longest team name, team location, or category. Bootstrap uses the same limit. */
export const rosterTextMax = 200;
export const teamsPerCommandMax = 300;
export const categoriesMax = 50;

/** Whether the text holds a control character, such as a null byte or a bell. */
export function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** Names that differ only by case, spacing at the ends, or Unicode form are the same name. */
export function rosterKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}
