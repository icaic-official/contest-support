import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { requireBackend } from "@/backend";
import {
  AvatarImageCache,
  type AvatarMap,
  avatarMap,
  noAvatars,
} from "./avatarImages";
import type { SessionData } from "./hooks/useSessionSnapshot";

interface AvatarContextValue {
  people: AvatarMap;
  images: AvatarImageCache;
  /** True when the caller has a picture. It can still be loading. */
  hasOwn: boolean;
  upload: (requestId: string, picture: Blob) => Promise<void>;
  remove: () => Promise<void>;
}

interface Loaded {
  sessionId: string;
  people: AvatarMap;
}

/** Without a provider, every avatar shows initials. */
const AvatarContext = createContext<AvatarContextValue | undefined>(undefined);

const noop = () => {};

/**
 * Reads the pictures that the person can see in the selected session, and
 * keeps one downloaded copy of each for every avatar on screen. The list loads
 * like announcements do: when the session or a live signal changes, and every
 * 10 seconds. A picture change sends no live signal, so the poll shows other
 * people's changes. A failed read keeps the earlier pictures.
 */
export function AvatarProvider({
  data,
  userId,
  children,
}: {
  data: SessionData;
  userId: string;
  children: ReactNode;
}) {
  const { sessionId, updates } = data;
  const allowed = Boolean(data.snapshot?.membership);
  const [loaded, setLoaded] = useState<Loaded>();
  // Only the newest read or change may set the list, so an older response
  // cannot bring back a picture that the person just replaced or removed.
  const newest = useRef(0);
  // Drop pictures that belong to another session or to lost access.
  // React discards this render and renders again before it commits.
  if (loaded && (loaded.sessionId !== sessionId || !allowed)) {
    setLoaded(undefined);
  }
  const people = loaded?.people ?? noAvatars;

  const images = useMemo(
    () =>
      new AvatarImageCache((avatar) =>
        requireBackend().avatars.download(sessionId, avatar),
      ),
    [sessionId],
  );
  useEffect(() => () => images.clear(), [images]);
  useEffect(() => {
    images.retain(new Set([...people.values()].map((item) => item.avatar_id)));
  }, [images, people]);

  const reload = useCallback(async () => {
    const run = ++newest.current;
    try {
      const list = await requireBackend().avatars.list(sessionId);
      if (run !== newest.current) return;
      setLoaded((previous) => ({
        sessionId,
        people: avatarMap(
          list,
          previous?.sessionId === sessionId ? previous.people : noAvatars,
        ),
      }));
    } catch {
      // A picture is optional. The next poll tries again.
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !allowed) return;
    void reload();
    const interval = window.setInterval(() => void reload(), 10000);
    return () => window.clearInterval(interval);
  }, [reload, sessionId, allowed, updates]);

  const upload = useCallback(
    async (requestId: string, picture: Blob) => {
      const avatar = await requireBackend().avatars.upload({
        requestId,
        file: picture,
      });
      newest.current++;
      images.seed(avatar, picture);
      setLoaded((previous) => ({
        sessionId,
        people: new Map(previous?.people).set(avatar.person_id, avatar),
      }));
    },
    [sessionId, images],
  );

  const remove = useCallback(async () => {
    await requireBackend().avatars.remove();
    newest.current++;
    setLoaded((previous) => {
      const next = new Map(previous?.people);
      next.delete(userId);
      return { sessionId, people: next };
    });
  }, [sessionId, userId]);

  const hasOwn = people.has(userId);
  const value = useMemo(
    () => ({ people, images, hasOwn, upload, remove }),
    [people, images, hasOwn, upload, remove],
  );
  return <AvatarContext value={value}>{children}</AvatarContext>;
}

/**
 * The object URL of a person's picture, or undefined while it loads, when the
 * person has none, or when the caller cannot see it. The first component that
 * shows a picture starts its download. Later components share it.
 */
export function useAvatarUrl(personId: string | undefined): string | undefined {
  const context = useContext(AvatarContext);
  const images = context?.images;
  const avatarId = personId ? context?.people.get(personId)?.avatar_id : undefined;
  const subscribe = useCallback(
    (listener: () => void) =>
      images && personId && avatarId
        ? images.subscribe({ person_id: personId, avatar_id: avatarId }, listener)
        : noop,
    [images, personId, avatarId],
  );
  const read = useCallback(
    () => (images && avatarId ? images.url(avatarId) : undefined),
    [images, avatarId],
  );
  return useSyncExternalStore(subscribe, read);
}

/** Replaces or removes the caller's own picture. Use it only under `AvatarProvider`. */
export function useAvatarActions(): Pick<
  AvatarContextValue,
  "hasOwn" | "upload" | "remove"
> {
  const context = useContext(AvatarContext);
  if (!context) throw new Error("Avatar controls need an AvatarProvider.");
  return context;
}
