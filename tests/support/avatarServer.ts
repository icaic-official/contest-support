import { expect, type Page } from "@playwright/test";
import { ImageRequestError } from "../../src/backend/errors";
import type { Membership } from "../../src/connected/model";
import { AuthenticationError } from "../../src/server/authentication";
import {
  type FakeWorker,
  SESSION_ID,
  TEAM_ID,
  USER_ID,
  fixtureAccount,
  sessionSnapshot,
} from "./worker";

export { USER_ID };
export const BEN_ID = "00000000-0000-4000-8000-000000000002";
const ISSUE_ID = "00000000-0000-4000-8000-000000000300";
export const SERVER_TIME = "2026-10-17T00:00:00Z";

export const staff: Membership = {
  session_id: SESSION_ID,
  user_id: USER_ID,
  team_id: null,
  roles: ["volunteer"],
  is_admin: false,
};
export const team: Membership = { ...staff, roles: [], team_id: TEAM_ID };

export interface Picture {
  id: string;
  bytes: Buffer;
}

/** What the fixture Worker holds and what it was asked to do. */
export interface Server {
  /** Pictures by person ID. */
  pictures: Map<string, Picture>;
  /** The avatar IDs of each list that the server returned. */
  lists: string[][];
  /** The avatar ID of each download. */
  downloads: string[];
  /** Every upload request that reached the server, including those whose answer was lost. */
  uploads: { requestId: string; bytes: Buffer }[];
  removals: number;
  /** The next upload fails with this error and stores nothing. */
  failNextUpload?: ImageRequestError | undefined;
}

let pictureCount = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++pictureCount).padStart(12, "5")}`;

export function picture(bytes: Buffer): Picture {
  return { id: nextId(), bytes };
}

/** Signs in through the Worker fixture, which keeps the pictures in memory. */
export async function openApp(
  page: Page,
  api: FakeWorker,
  options: {
    membership?: Membership;
    pictures?: [string, Buffer][];
    startPath?: string;
  } = {},
): Promise<Server> {
  const membership = options.membership ?? staff;
  const server: Server = {
    pictures: new Map(
      (options.pictures ?? []).map(([person, bytes]) => [person, picture(bytes)]),
    ),
    lists: [],
    downloads: [],
    uploads: [],
    removals: 0,
  };
  const byRequest = new Map<string, Picture>();
  const person = (id: string, name: string, username: string) => ({
    membership: { ...staff, user_id: id },
    person: { id, name, username },
  });
  // The Worker shows staff the pictures of staff. A team sees only its own.
  const visible = () =>
    [...server.pictures].filter(([owner]) => !membership.team_id || owner === USER_ID);
  api.account = fixtureAccount(USER_ID, "ada", "Ada Lovelace");
  const state = sessionSnapshot(membership, {
    session: { name: "Picture session" },
    event: { id: "00000000-0000-4000-8000-000000000090", name: "Picture event", archived: false },
    issues: membership.team_id
      ? []
      : [
          {
            id: ISSUE_ID,
            number: 1,
            session_id: SESSION_ID,
            team_id: TEAM_ID,
            reporter: BEN_ID,
            reporter_name: "Ben Okoro",
            category: "Network",
            description: "The switch has no link light",
            status: "claimed",
            created_at: "2026-10-16T23:50:00Z",
            first_assigned_at: "2026-10-16T23:52:00Z",
            owner: BEN_ID,
            owner_name: "Ben Okoro",
            resolved_at: null,
            revision: 0,
          },
        ],
    members: membership.team_id
      ? []
      : [
          person(USER_ID, "Ada Lovelace", "ada"),
          person(BEN_ID, "Ben Okoro", "ben"),
        ],
    server_time: SERVER_TIME,
  });
  api.snapshots = () => [state];
  api.avatars = {
    list: async () => {
      server.lists.push(visible().map(([, item]) => item.id));
      return visible().map(([owner, item]) => ({ person_id: owner, avatar_id: item.id }));
    },
    download: async (_caller, _sessionId, avatarId) => {
      const found = visible().find(([, item]) => item.id === avatarId)?.[1];
      if (!found) throw new AuthenticationError(403, "The picture is not available.");
      server.downloads.push(avatarId);
      return { body: new Response(new Uint8Array(found.bytes)).body!, contentType: "image/png" };
    },
    upload: async (_caller, { requestId, bytes }) => {
      const failure = server.failNextUpload;
      server.failNextUpload = undefined;
      server.uploads.push({ requestId, bytes: Buffer.from(bytes) });
      if (failure) throw failure;
      // A repeated request ID returns its first result and stores nothing more.
      const stored = byRequest.get(requestId) ?? picture(Buffer.from(bytes));
      byRequest.set(requestId, stored);
      server.pictures.set(USER_ID, stored);
      return { person_id: USER_ID, avatar_id: stored.id };
    },
    remove: async () => {
      server.removals += 1;
      server.pictures.delete(USER_ID);
    },
  };
  const startPath = options.startPath ?? "/sign-in";
  await page.goto(startPath);
  await page.getByLabel("Username", { exact: true }).fill("ada");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ui]")).toBeVisible();
  return server;
}
