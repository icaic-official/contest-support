export const MIB = 1048576;
export const THUMBNAIL_BYTES = 524288;
/** The profile picture limit for both providers. A 512 by 512 JPEG or WebP picture fits below it. */
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

export function attachmentPath(
  sessionId: string,
  issueId: string,
  attachmentId: string,
  kind: "original" | "thumbnail",
): string {
  return `${sessionId}/${issueId}/${attachmentId}/${kind}`;
}
