import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));
const resolver = 'adapters/cloudflare/authority.ts';

/**
 * The text of a hand-written access check. Readers embed contestDataSql instead.
 * A delete reads nothing, so `DELETE FROM grants` is not a copy.
 */
const accessJoin = /JOIN memberships|FROM memberships m\b|JOIN grants|(?<!DELETE )FROM grants/g;

/**
 * Trusted terminal commands that check an admin membership without a login.
 * The resolver needs a login, so it cannot answer for them.
 */
const terminalCommands = new Set(['adapters/cloudflare/installation.ts']);

function serverFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return serverFiles(path);
    return /\.(?:ts|mjs)$/.test(entry.name) && !/\.test\.(?:ts|mjs)$/.test(entry.name) ? [relative(serverRoot, path)] : [];
  });
}

function accessJoins(source: string): string[] {
  return [...source.matchAll(accessJoin)].map((match) => match[0]);
}

describe('one access check', () => {
  const files = serverFiles(serverRoot);

  it('finds the resolver and the server files', () => {
    expect(files).toContain(resolver);
    expect(accessJoins(readFileSync(join(serverRoot, resolver), 'utf8')).length).toBeGreaterThan(0);
  });

  it('keeps every access join in authority.ts', () => {
    const copies = files.filter((file) => file !== resolver && !terminalCommands.has(file))
      .flatMap((file) => accessJoins(readFileSync(join(serverRoot, file), 'utf8')).map((text) => `${file}: ${text}`));
    expect(copies).toEqual([]);
  });

  it('lists only terminal commands that still check memberships', () => {
    for (const file of terminalCommands) {
      expect(accessJoins(readFileSync(join(serverRoot, file), 'utf8')), file).not.toEqual([]);
    }
  });

  it('recognizes a copied access join', () => {
    expect(accessJoins('FROM accounts a JOIN memberships m ON m.account_id = a.id')).toEqual(['JOIN memberships']);
    expect(accessJoins('SELECT 1 FROM memberships m WHERE m.is_admin = 1')).toEqual(['FROM memberships m']);
    expect(accessJoins('LEFT JOIN grants g ON g.account_id = a.id')).toEqual(['JOIN grants']);
    expect(accessJoins('SELECT team_id FROM memberships WHERE session_id = ?')).toEqual([]);
    expect(accessJoins("SELECT 1 FROM grants WHERE scope = 'site'")).toEqual(['FROM grants']);
    expect(accessJoins("DELETE FROM grants WHERE scope = 'site' AND account_id = ?")).toEqual([]);
  });
});
