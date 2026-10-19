import { ImageRequestError } from "../../backend/errors";

export async function thumbnailBlob(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageRequestError("Choose a JPEG, PNG, or WebP image.", {
      validation: true,
    });
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 480 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new ImageRequestError("Choose a JPEG, PNG, or WebP image.", {
        validation: true,
      });
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.8);
    });
    if (!blob || blob.size > 524288) {
      throw new ImageRequestError("Choose a JPEG, PNG, or WebP image.", {
        validation: true,
      });
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

export function isImageRequestError(error: unknown): error is ImageRequestError {
  return error instanceof ImageRequestError;
}
