import { ANNOUNCEMENT_IMAGE_MAX_BYTES } from "./announcementModel";
import { imageKind, megabytes } from "./imageFile";

/** Checks a chosen file before upload. Providers check size and signature again. */
export async function checkAnnouncementImage(file: File): Promise<string | undefined> {
  if (file.size < 1 || file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    return `Choose an image of up to ${megabytes(ANNOUNCEMENT_IMAGE_MAX_BYTES)} MB.`;
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!imageKind(header)) return "Choose a JPEG, PNG, or WebP image.";
  // Decode first so a damaged image fails with a clear message before upload.
  try {
    (await createImageBitmap(file)).close();
  } catch {
    return "Choose a readable JPEG, PNG, or WebP image.";
  }
  return undefined;
}
