export const MIB = 1048576;
export const THUMBNAIL_BYTES = 524288;
/** The browser re-encodes a profile picture to at most 512 by 512 pixels before upload. */
export const AVATAR_MAX_BYTES = 262144;

export function imageKind(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export function megabytes(bytes: number): number {
  return Math.round(bytes / MIB);
}

export function imageRejection(
  bytes: number,
  kind: string | undefined,
  limits: { maxImageBytes: number; maxImages: number; maxTotalBytes: number },
  existing: { count: number; totalBytes: number },
): string | undefined {
  if (!kind) return "Choose a JPEG, PNG, or WebP image.";
  if (bytes > limits.maxImageBytes) {
    return `This image is larger than ${megabytes(limits.maxImageBytes)} MB.`;
  }
  if (existing.count >= limits.maxImages) {
    return `This issue already has ${limits.maxImages} images.`;
  }
  if (existing.totalBytes + bytes > limits.maxTotalBytes) {
    return `These images would exceed this issue's ${megabytes(limits.maxTotalBytes)} MB limit.`;
  }
  return undefined;
}

export function classifyAttachmentError(message: string): {
  validation: boolean;
  restart: boolean;
} {
  const validation = [
    "Choose a JPEG, PNG, or WebP image.",
    "This image is larger than",
    "These images would exceed",
    "This issue already has",
    "This event is archived.",
    "You do not have permission",
    "Only the person who added this image",
    "Choose who can see this image.",
    "Choose a maximum",
    "The issue total must be",
    "No access to this session.",
    "Image unavailable.",
    "Change your temporary password or sign in again.",
  ].some((prefix) => message.startsWith(prefix));
  const restart = message.startsWith("Upload the image before finishing.") ||
    message.startsWith("Upload failed.");
  return { validation, restart };
}

export function attachmentPath(
  sessionId: string,
  issueId: string,
  attachmentId: string,
  kind: "original" | "thumbnail",
): string {
  return `${sessionId}/${issueId}/${attachmentId}/${kind}`;
}
