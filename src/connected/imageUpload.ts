import { ImageRequestError } from "../backend/errors";
import { THUMBNAIL_BYTES } from "./imageFile";

function unreadable(): ImageRequestError {
  return new ImageRequestError("Choose a JPEG, PNG, or WebP image.", {
    validation: true,
  });
}

async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw unreadable();
  }
}

/**
 * Draws a region of the bitmap on a canvas and encodes it as JPEG. A canvas
 * keeps no metadata, so the result has no EXIF or location data.
 */
async function encodeJpeg(
  bitmap: ImageBitmap,
  region: { x: number; y: number; width: number; height: number },
  output: { width: number; height: number },
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) throw unreadable();
  context.drawImage(
    bitmap,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    output.width,
    output.height,
  );
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

export async function thumbnailBlob(file: Blob): Promise<Blob> {
  const bitmap = await decodeImage(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 480 / longest);
    const blob = await encodeJpeg(
      bitmap,
      { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      {
        width: Math.max(1, Math.round(bitmap.width * scale)),
        height: Math.max(1, Math.round(bitmap.height * scale)),
      },
      0.8,
    );
    if (!blob || blob.size > THUMBNAIL_BYTES) throw unreadable();
    return blob;
  } finally {
    bitmap.close();
  }
}

export function isImageRequestError(error: unknown): error is ImageRequestError {
  return error instanceof ImageRequestError;
}
