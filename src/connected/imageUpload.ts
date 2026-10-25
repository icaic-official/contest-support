import { ImageRequestError } from "../backend/errors";
import { centeredSquare, encodeAttempts, firstFit } from "./avatarPicture";
import { AVATAR_MAX_BYTES, THUMBNAIL_BYTES } from "./imageFile";

function unreadable(): ImageRequestError {
  return new ImageRequestError("Choose a JPEG, PNG, or WebP image.", {
    validation: true,
  });
}

/** Decodes a chosen file. A phone photo must come out upright, so the EXIF orientation applies. */
async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // A browser that does not know the option applies the orientation by default.
    try {
      return await createImageBitmap(file);
    } catch {
      throw unreadable();
    }
  }
}

/**
 * Draws a region of the bitmap on a canvas and encodes it as JPEG. A canvas
 * keeps no metadata, so the result has no EXIF or location data. JPEG has no
 * transparency, so a `background` replaces the black that clear pixels give.
 */
async function encodeJpeg(
  bitmap: ImageBitmap,
  region: { x: number; y: number; width: number; height: number },
  output: { width: number; height: number },
  quality: number,
  background?: string,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) throw unreadable();
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, output.width, output.height);
  }
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

/**
 * Crops the middle square of a chosen file and encodes it as a JPEG of at
 * most 512 by 512 pixels that fits the avatar limit. The new encoding drops
 * EXIF and location data.
 */
export async function avatarBlob(file: Blob): Promise<Blob> {
  const bitmap = await decodeImage(file);
  try {
    const square = centeredSquare(bitmap.width, bitmap.height);
    const blob = await firstFit(
      encodeAttempts(square.size),
      ({ side, quality }) =>
        encodeJpeg(
          bitmap,
          { x: square.x, y: square.y, width: square.size, height: square.size },
          { width: side, height: side },
          quality,
          "#fff",
        ),
      AVATAR_MAX_BYTES,
    );
    if (!blob) {
      throw new ImageRequestError(
        "This picture cannot be made small enough. Choose another image.",
        { validation: true },
      );
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

export function isImageRequestError(error: unknown): error is ImageRequestError {
  return error instanceof ImageRequestError;
}
