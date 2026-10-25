import { z } from 'zod';
import type { RosterCommand } from '../backend/contracts';

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

const text = (min: number) => z.string().trim().min(min).max(rosterTextMax)
  .refine((value) => !hasControlCharacter(value), 'Remove control characters.');

/** Names that differ only by case, spacing at the ends, or Unicode form are the same name. */
export function rosterKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

function distinct(names: readonly string[]): boolean {
  return new Set(names.map(rosterKey)).size === names.length;
}

/** The one parser for the roster commands. The browser and the Worker both use it. */
export const rosterCommandSchema: z.ZodType<RosterCommand> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add_teams'),
    teams: z.array(z.strictObject({ id: z.uuid(), name: text(1), location: text(0) }))
      .min(1).max(teamsPerCommandMax)
      .refine((teams) => distinct(teams.map((team) => team.name)), 'Team names must be different.')
      .refine((teams) => new Set(teams.map((team) => team.id)).size === teams.length),
  }),
  z.strictObject({ type: z.literal('update_team'), teamId: z.uuid(), name: text(1), location: text(0) }),
  z.strictObject({ type: z.literal('delete_team'), teamId: z.uuid() }),
  z.strictObject({
    type: z.literal('set_categories'),
    categories: z.array(text(1)).min(1).max(categoriesMax)
      .refine(distinct, 'Category names must be different.'),
  }),
]);
