import type { PersonAvatar } from "@/backend/contracts";

/** The pictures that the caller can see in one session, by person ID. */
export type AvatarMap = ReadonlyMap<string, PersonAvatar>;

export const noAvatars: AvatarMap = new Map();

/**
 * Returns `previous` when the list holds the same pictures. An unchanged list
 * then causes no render, because each avatar ID changes on every upload.
 */
export function avatarMap(
  list: readonly PersonAvatar[],
  previous: AvatarMap = noAvatars,
): AvatarMap {
  const next = new Map(list.map((avatar) => [avatar.person_id, avatar]));
  const same =
    next.size === previous.size &&
    [...next].every(
      ([person, avatar]) => previous.get(person)?.avatar_id === avatar.avatar_id,
    );
  return same ? previous : next;
}

/** One avatar ID. Its picture never changes, so the ID is a safe cache key. */
interface Entry {
  avatar: PersonAvatar;
  url: string | undefined;
  failed: boolean;
  listeners: Set<() => void>;
}

/**
 * Downloads each picture once and shares its object URL between every
 * consumer. A consumer subscribes with `subscribe` and reads `url`, as
 * `useSyncExternalStore` expects. `retain` revokes the URLs of pictures that
 * left the list, and `clear` revokes all of them. A download that ends after
 * its entry left the cache revokes its own URL, so none leaks.
 */
export class AvatarImageCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly download: (avatar: PersonAvatar) => Promise<Blob>,
    private readonly createUrl: (blob: Blob) => string = (blob) =>
      URL.createObjectURL(blob),
    private readonly revokeUrl: (url: string) => void = (url) =>
      URL.revokeObjectURL(url),
  ) {}

  /** The object URL once the picture has loaded. */
  url(avatarId: string): string | undefined {
    return this.entries.get(avatarId)?.url;
  }

  /** Starts the download for the first subscriber. Others share it. */
  subscribe(avatar: PersonAvatar, listener: () => void): () => void {
    let entry = this.entries.get(avatar.avatar_id);
    if (!entry) {
      entry = { avatar, url: undefined, failed: false, listeners: new Set() };
      this.entries.set(avatar.avatar_id, entry);
      this.load(entry);
    }
    entry.listeners.add(listener);
    const subscribed = entry;
    return () => {
      subscribed.listeners.delete(listener);
    };
  }

  /**
   * Keeps only the listed pictures. A picture that failed to download starts
   * again when someone still watches it, so a short network loss heals.
   */
  retain(avatarIds: ReadonlySet<string>): void {
    for (const [id, entry] of this.entries) {
      if (!avatarIds.has(id)) {
        this.evict(id, entry);
      } else if (entry.failed && entry.listeners.size > 0) {
        this.load(entry);
      }
    }
  }

  /** Shows a picture that the caller already holds, such as one just uploaded. */
  seed(avatar: PersonAvatar, blob: Blob): void {
    let entry = this.entries.get(avatar.avatar_id);
    if (!entry) {
      entry = { avatar, url: undefined, failed: false, listeners: new Set() };
      this.entries.set(avatar.avatar_id, entry);
    }
    if (entry.url) return;
    entry.url = this.createUrl(blob);
    entry.failed = false;
    this.notify(entry);
  }

  /** Revokes every URL. The cache works again after this call. */
  clear(): void {
    for (const [id, entry] of this.entries) this.evict(id, entry);
  }

  private load(entry: Entry): void {
    entry.failed = false;
    this.download(entry.avatar).then(
      (blob) => {
        const url = this.createUrl(blob);
        if (this.entries.get(entry.avatar.avatar_id) !== entry || entry.url) {
          this.revokeUrl(url);
          return;
        }
        entry.url = url;
        this.notify(entry);
      },
      () => {
        if (this.entries.get(entry.avatar.avatar_id) !== entry) return;
        entry.failed = true;
        this.notify(entry);
      },
    );
  }

  private evict(id: string, entry: Entry): void {
    this.entries.delete(id);
    if (entry.url) this.revokeUrl(entry.url);
    entry.url = undefined;
    this.notify(entry);
  }

  private notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) listener();
  }
}
