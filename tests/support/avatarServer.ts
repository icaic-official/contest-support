import { expect, type Page, type Request } from "@playwright/test";
import { emptyAnnouncementSnapshot } from "./announcementSnapshot";
import type { Membership, Snapshot } from "../../src/connected/model";

export const USER_ID = "00000000-0000-4000-8000-000000000001";
export const BEN_ID = "00000000-0000-4000-8000-000000000002";
const SESSION_ID = "00000000-0000-4000-8000-000000000100";
const TEAM_ID = "00000000-0000-4000-8000-000000000200";
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

/** What the mocked server holds and what it was asked to do. */
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
  /**
   * The next upload fails. A rejection stores nothing. A "drop" stores the
   * picture, but the browser never gets the answer.
   */
  failNextUpload?: { status: number; body: unknown } | "drop";
}

let pictureCount = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++pictureCount).padStart(12, "5")}`;

export function picture(bytes: Buffer): Picture {
  return { id: nextId(), bytes };
}

/** The text fields and files of a multipart request body. */
function formParts(request: Request): Map<string, Buffer> {
  const boundary = /boundary=(.+)$/.exec(request.headers()["content-type"])?.[1];
  const body = request.postDataBuffer();
  if (!boundary || !body) throw new Error("Expected a multipart request.");
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = new Map<string, Buffer>();
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const name = /name="([^"]+)"/.exec(part.subarray(0, split).toString())?.[1];
    if (name) parts.set(name, part.subarray(split + 4));
    start = next;
  }
  return parts;
}

/** Signs in with isolated Auth, database, Storage and function responses. */
export async function openApp(
  page: Page,
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
  const state: Snapshot = {
    session: {
      id: SESSION_ID,
      event_id: "00000000-0000-4000-8000-000000000090",
      name: "Picture session",
      intake_open: true,
      categories: ["Network"],
      revision: 0,
      max_image_bytes: 10 * 1024 * 1024,
      max_images_per_issue: 20,
      max_image_bytes_per_issue: 120 * 1024 * 1024,
    },
    event: {
      id: "00000000-0000-4000-8000-000000000090",
      name: "Picture event",
      archived: false,
    },
    membership,
    teams: [
      { id: TEAM_ID, session_id: SESSION_ID, name: "Aurora", location: "Desk 12" },
    ],
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
    resolutions: [],
    history: [],
    attachments: [],
    pending_removals: [],
    awards: [],
    audit: [],
    members: membership.team_id
      ? []
      : [
          person(USER_ID, "Ada Lovelace", "ada"),
          person(BEN_ID, "Ben Okoro", "ben"),
        ],
    server_time: SERVER_TIME,
  };
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "ada@accounts.minsky.invalid",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: SERVER_TIME,
  };
  await page.routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.route("https://example.supabase.co/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    if (path === "/rest/v1/rpc/avatar_list") {
      // The server shows staff the pictures of staff. A team sees only its own.
      const visible = [...server.pictures].filter(
        ([owner]) => !membership.team_id || owner === USER_ID,
      );
      server.lists.push(visible.map(([, item]) => item.id));
      return json(
        visible.map(([owner, item]) => ({ person_id: owner, avatar_id: item.id })),
      );
    }
    if (path.startsWith("/storage/v1/object/person-avatars/")) {
      const [owner, id] = path.split("/").slice(-2);
      const found = server.pictures.get(owner);
      if (found?.id !== id) return json({ message: "Not found" }, 404);
      server.downloads.push(id);
      return route.fulfill({ status: 200, contentType: "image/png", body: found.bytes });
    }
    if (path === "/functions/v1/avatars") {
      if (request.headers()["content-type"]?.startsWith("application/json")) {
        server.removals += 1;
        server.pictures.delete(USER_ID);
        return json({});
      }
      const failure = server.failNextUpload;
      server.failNextUpload = undefined;
      const parts = formParts(request);
      const requestId = parts.get("request_id")!.toString();
      const bytes = parts.get("image")!;
      server.uploads.push({ requestId, bytes });
      if (failure && failure !== "drop") return json(failure.body, failure.status);
      // A repeated request ID returns its first result and stores nothing more.
      const stored = byRequest.get(requestId) ?? picture(bytes);
      byRequest.set(requestId, stored);
      server.pictures.set(USER_ID, stored);
      if (failure === "drop") return route.abort("failed");
      return json({ person_id: USER_ID, avatar_id: stored.id });
    }
    const responses: Record<string, unknown> = {
      "/auth/v1/token": {
        access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
          sub: USER_ID,
          exp: expires,
          role: "authenticated",
        })}.fixture`,
        refresh_token: "picture-fixture",
        expires_in: 3600,
        expires_at: expires,
        token_type: "bearer",
        user,
      },
      "/auth/v1/user": user,
      "/auth/v1/logout": null,
      "/rest/v1/rpc/account_status": {
        username: "ada",
        must_change: false,
        session_valid: true,
      },
      "/rest/v1/memberships": [membership],
      "/rest/v1/sessions": [{ id: SESSION_ID, name: "Picture session" }],
      "/rest/v1/rpc/session_snapshot": state,
      "/rest/v1/rpc/announcement_snapshot": emptyAnnouncementSnapshot(),
    };
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
    return json(responses[path]);
  });
  const startPath = options.startPath ?? "/sign-in";
  await page.goto(startPath);
  await page.getByLabel("Username", { exact: true }).fill("ada");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ui]")).toBeVisible();
  return server;
}

