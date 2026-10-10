import { requireClient } from "./client";
import {
  type ImageRequestError as ImageRequestErrorType,
  ImageRequestError,
  classifyAttachmentError,
} from "./imageFile";

const bucket = "issue-attachments";

export type StartedImage = {
  id: string;
  original_path: string;
  thumbnail_path: string;
};

export type ImageTransport = {
  begin(input: {
    sessionId: string;
    issueId: string;
    visibility: "public" | "internal";
    name: string;
    bytes: number;
  }): Promise<StartedImage>;
  upload(
    path: string,
    body: Blob,
    contentType: string,
    onProgress: (loaded: number) => void,
  ): Promise<void>;
  finish(sessionId: string, attachmentId: string): Promise<void>;
  remove(sessionId: string, attachmentId: string): Promise<void>;
  abandon(sessionId: string, attachmentId: string): Promise<void>;
  download(path: string): Promise<Blob>;
};

type FunctionPayload = {
  error?: string;
  validation?: boolean;
  restart?: boolean;
  id?: string;
  original_path?: string;
  thumbnail_path?: string;
};

async function invoke(body: Record<string, unknown>): Promise<FunctionPayload> {
  const result = await requireClient().functions.invoke("attachments", { body });
  if (result.error) {
    let message = "Upload failed. Check your connection and try again.";
    const context = "context" in result.error ? result.error.context : undefined;
    if (context instanceof Response) {
      const payload = await context.json().catch(() => undefined) as
        | FunctionPayload
        | undefined;
      if (payload?.error) message = payload.error;
    }
    const classified = classifyAttachmentError(message);
    throw new ImageRequestError(message, classified);
  }
  return (result.data ?? {}) as FunctionPayload;
}

export const liveImageTransport: ImageTransport = {
  async begin(input) {
    const data = await invoke({
      action: "begin",
      session_id: input.sessionId,
      request_id: crypto.randomUUID(),
      issue_id: input.issueId,
      visibility: input.visibility,
      name: input.name,
      bytes: input.bytes,
    });
    if (!data.id || !data.original_path || !data.thumbnail_path) {
      throw new ImageRequestError(
        "Upload failed. Check your connection and try again.",
        { restart: true },
      );
    }
    return {
      id: data.id,
      original_path: data.original_path,
      thumbnail_path: data.thumbnail_path,
    };
  },
  upload(path, body, contentType, onProgress) {
    return uploadStoredObject(path, body, contentType, onProgress);
  },
  async finish(sessionId, attachmentId) {
    await invoke({
      action: "finish",
      session_id: sessionId,
      attachment_id: attachmentId,
    });
  },
  async remove(sessionId, attachmentId) {
    await invoke({
      action: "remove",
      session_id: sessionId,
      attachment_id: attachmentId,
    });
  },
  async abandon(sessionId, attachmentId) {
    await invoke({
      action: "abandon",
      session_id: sessionId,
      attachment_id: attachmentId,
    });
  },
  async download(path) {
    const { data, error } = await requireClient().storage.from(bucket).download(path);
    if (error || !data) throw new ImageRequestError("This image could not be opened.");
    return data;
  },
};

export async function uploadStoredObject(
  path: string,
  body: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const { data } = await requireClient().auth.getSession();
  const token = data.session?.access_token;
  if (!url || !key || !token) throw new ImageRequestError("Sign in first.", { restart: true });
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${url}/storage/v1/object/${bucket}/${encoded}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "private, max-age=0");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size);
        resolve();
        return;
      }
      if (xhr.status === 401 || xhr.status === 403) {
        reject(new ImageRequestError(
          "You do not have permission to add images to this issue.",
          { validation: true },
        ));
        return;
      }
      reject(new ImageRequestError(
        "Upload failed. Check your connection and try again.",
      ));
    };
    xhr.onerror = () => {
      reject(new ImageRequestError(
        "Upload failed. Check your connection and try again.",
      ));
    };
    xhr.send(body);
  });
}

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

export function isImageRequestError(error: unknown): error is ImageRequestErrorType {
  return error instanceof ImageRequestError;
}
