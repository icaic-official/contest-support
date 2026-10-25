import { ImageRequestError } from "@/backend/errors";
import { MIB } from "./imageFile";

/** The largest file that a person can choose. The browser encodes it again before upload. */
export const AVATAR_SOURCE_MAX_BYTES = 2 * MIB;
const AVATAR_SIDES = [512, 384, 256];
const AVATAR_QUALITIES = [0.9, 0.8, 0.7, 0.55];

export interface Square {
  x: number;
  y: number;
  size: number;
}

/** The centered square of an image. */
export function centeredSquare(width: number, height: number): Square {
  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size,
  };
}

export interface EncodeAttempt {
  /** The width and height of the encoded picture, in pixels. */
  side: number;
  quality: number;
}

/**
 * The encodings to try, from the sharpest to the smallest. A small image is
 * never enlarged, so no attempt is larger than the square.
 */
export function encodeAttempts(squareSize: number): EncodeAttempt[] {
  const sides = [...new Set(AVATAR_SIDES.map((side) => Math.min(side, squareSize)))];
  return sides.flatMap((side) =>
    AVATAR_QUALITIES.map((quality) => ({ side, quality })),
  );
}

/** The first encoding that fits in `maxBytes`, or undefined when none does. */
export async function firstFit(
  attempts: readonly EncodeAttempt[],
  encode: (attempt: EncodeAttempt) => Promise<Blob | null>,
  maxBytes: number,
): Promise<Blob | undefined> {
  for (const attempt of attempts) {
    const blob = await encode(attempt);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return undefined;
}

/** A picture that is ready to upload. The same file keeps the same request ID. */
export interface AvatarDraft {
  blob: Blob;
  requestId: string;
}

/**
 * What the picture controls show. A draft exists only in `preview` and
 * `uploading`, so a screen cannot save a picture that is not ready.
 */
export type AvatarEditor =
  | { phase: "idle"; error: string }
  | { phase: "preparing" }
  | { phase: "preview"; draft: AvatarDraft; error: string }
  | { phase: "uploading"; draft: AvatarDraft }
  | { phase: "confirmRemoval" }
  | { phase: "removing" };

export const idleEditor: AvatarEditor = { phase: "idle", error: "" };

/**
 * The state after a failed upload. A rejected or expired upload ends the
 * attempt, so the person chooses the picture again and gets a new request ID.
 * An unknown outcome keeps the draft and its request ID. A retry then cannot
 * store a second picture.
 */
export function uploadFailed(cause: unknown, draft: AvatarDraft): AvatarEditor {
  if (cause instanceof ImageRequestError && (cause.validation || cause.restart)) {
    return { phase: "idle", error: cause.message };
  }
  return {
    phase: "preview",
    draft,
    error:
      cause instanceof ImageRequestError
        ? cause.message
        : "The picture may not have saved. Check your connection and try again.",
  };
}
