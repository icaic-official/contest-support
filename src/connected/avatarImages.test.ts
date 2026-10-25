import { describe, expect, it, vi } from "vitest";
import type { PersonAvatar } from "@/backend/contracts";
import { AvatarImageCache, avatarMap, noAvatars } from "./avatarImages";

const avatar = (person: string, id: string): PersonAvatar => ({
  person_id: person,
  avatar_id: id,
});

/** A download that the test finishes by hand. */
function deferred() {
  let resolve!: (blob: Blob) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Blob>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const downloads = new Map<string, ReturnType<typeof deferred>[]>();
  const download = vi.fn((item: PersonAvatar) => {
    const pending = deferred();
    downloads.set(item.avatar_id, [...(downloads.get(item.avatar_id) ?? []), pending]);
    return pending.promise;
  });
  let count = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  const cache = new AvatarImageCache(
    download,
    () => {
      const url = `blob:${++count}`;
      created.push(url);
      return url;
    },
    (url) => revoked.push(url),
  );
  const finish = async (id: string, index = 0) => {
    downloads.get(id)![index].resolve(new Blob(["x"]));
    await Promise.resolve();
    await Promise.resolve();
  };
  const fail = async (id: string, index = 0) => {
    downloads.get(id)![index].reject(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { cache, download, created, revoked, finish, fail };
}

describe("avatarMap", () => {
  it("maps each person to the picture they have", () => {
    const map = avatarMap([avatar("p1", "a1"), avatar("p2", "a2")]);
    expect(map.get("p1")?.avatar_id).toBe("a1");
    expect(map.get("p2")?.avatar_id).toBe("a2");
    expect(map.get("p3")).toBeUndefined();
  });

  it("returns the previous map for the same pictures, so nothing renders again", () => {
    const first = avatarMap([avatar("p1", "a1")]);
    expect(avatarMap([avatar("p1", "a1")], first)).toBe(first);
    expect(avatarMap([], noAvatars)).toBe(noAvatars);
  });

  it("returns a new map when a picture changed, appeared, or went away", () => {
    const first = avatarMap([avatar("p1", "a1")]);
    expect(avatarMap([avatar("p1", "a2")], first)).not.toBe(first);
    expect(avatarMap([avatar("p1", "a1"), avatar("p2", "a3")], first)).not.toBe(first);
    expect(avatarMap([], first)).not.toBe(first);
  });
});

describe("AvatarImageCache", () => {
  it("downloads a picture once for many consumers", async () => {
    const { cache, download, finish, created } = setup();
    const notified = [vi.fn(), vi.fn(), vi.fn()];
    for (const listener of notified) cache.subscribe(avatar("p1", "a1"), listener);
    expect(download).toHaveBeenCalledTimes(1);
    expect(cache.url("a1")).toBeUndefined();
    await finish("a1");
    expect(created).toHaveLength(1);
    expect(cache.url("a1")).toBe(created[0]);
    for (const listener of notified) expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the picture when the last consumer leaves", async () => {
    const { cache, download, finish, revoked } = setup();
    const stop = cache.subscribe(avatar("p1", "a1"), () => {});
    await finish("a1");
    stop();
    cache.subscribe(avatar("p1", "a1"), () => {});
    expect(download).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([]);
  });

  it("revokes a picture that left the list and keeps the others", async () => {
    const { cache, finish, created, revoked } = setup();
    cache.subscribe(avatar("p1", "a1"), () => {});
    cache.subscribe(avatar("p2", "a2"), () => {});
    await finish("a1");
    await finish("a2");
    cache.retain(new Set(["a2"]));
    expect(revoked).toEqual([created[0]]);
    expect(cache.url("a1")).toBeUndefined();
    expect(cache.url("a2")).toBe(created[1]);
  });

  it("revokes the URL of a download that ends after its picture was evicted", async () => {
    const { cache, finish, created, revoked } = setup();
    const listener = vi.fn();
    cache.subscribe(avatar("p1", "a1"), listener);
    cache.retain(new Set());
    await finish("a1");
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
    expect(cache.url("a1")).toBeUndefined();
  });

  it("downloads again after a picture was evicted and wanted later", async () => {
    const { cache, download, finish, created } = setup();
    cache.subscribe(avatar("p1", "a1"), () => {});
    await finish("a1");
    cache.retain(new Set());
    cache.subscribe(avatar("p1", "a1"), () => {});
    expect(download).toHaveBeenCalledTimes(2);
    await finish("a1", 1);
    expect(cache.url("a1")).toBe(created[1]);
  });

  it("works again after clear, as React StrictMode needs", async () => {
    const { cache, download, finish, created, revoked } = setup();
    cache.subscribe(avatar("p1", "a1"), () => {});
    await finish("a1");
    cache.clear();
    expect(revoked).toEqual([created[0]]);
    cache.subscribe(avatar("p1", "a1"), () => {});
    await finish("a1", 1);
    expect(download).toHaveBeenCalledTimes(2);
    expect(cache.url("a1")).toBe(created[1]);
  });

  it("shows a seeded picture without a download and revokes it on eviction", () => {
    const { cache, download, created, revoked } = setup();
    const listener = vi.fn();
    cache.seed(avatar("p1", "a1"), new Blob(["x"]));
    cache.subscribe(avatar("p1", "a1"), listener);
    expect(download).not.toHaveBeenCalled();
    expect(cache.url("a1")).toBe(created[0]);
    cache.retain(new Set());
    expect(revoked).toEqual([created[0]]);
  });

  it("lets a seed win over a download that is still running", async () => {
    const { cache, finish, created, revoked } = setup();
    cache.subscribe(avatar("p1", "a1"), () => {});
    cache.seed(avatar("p1", "a1"), new Blob(["x"]));
    await finish("a1");
    expect(cache.url("a1")).toBe(created[0]);
    expect(revoked).toEqual([created[1]]);
  });

  it("tries a failed download again when someone still watches it", async () => {
    const { cache, download, finish, fail, created } = setup();
    const listener = vi.fn();
    cache.subscribe(avatar("p1", "a1"), listener);
    await fail("a1");
    expect(cache.url("a1")).toBeUndefined();
    cache.retain(new Set(["a1"]));
    expect(download).toHaveBeenCalledTimes(2);
    await finish("a1", 1);
    expect(cache.url("a1")).toBe(created[0]);
  });

  it("does not try again when nobody watches the failed picture", async () => {
    const { cache, download, fail } = setup();
    const stop = cache.subscribe(avatar("p1", "a1"), () => {});
    await fail("a1");
    stop();
    cache.retain(new Set(["a1"]));
    expect(download).toHaveBeenCalledTimes(1);
  });
});
