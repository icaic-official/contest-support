import { type RefObject, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/backend/errors";
import { useAvatarActions } from "../Avatars";
import {
  AVATAR_SOURCE_MAX_BYTES,
  type AvatarEditor,
  idleEditor,
  uploadFailed,
} from "../avatarPicture";
import { checkImageFile } from "../imageCheck";
import { avatarBlob } from "../imageUpload";

/** The id of the control that opens the picker. Focus falls back to it after a step ends. */
export const changePictureButtonId = "account-change-picture";

export interface AvatarEditorControls {
  editor: AvatarEditor;
  /** True when the person has a picture to remove. */
  hasPicture: boolean;
  /** True while a step runs and the controls wait. */
  busy: boolean;
  /** The file input that `pick` opens. Render it once. */
  inputRef: RefObject<HTMLInputElement | null>;
  pick: () => void;
  /** Checks the file, crops it and encodes it. Then the person previews it. */
  choose: (file: File | undefined) => Promise<void>;
  /** Uploads the previewed picture. */
  save: () => Promise<void>;
  /** Asks the person to confirm the removal. */
  askRemove: () => void;
  /** Closes the preview or the removal question. */
  cancel: () => void;
  /** Removes the picture after the person confirmed. */
  remove: () => Promise<void>;
}

/**
 * The steps of changing the caller's own picture: choose a file, preview the
 * encoded square, then save. Each file gets one request ID, and a retry of
 * the same upload reuses it and its bytes. See `uploadFailed`.
 */
export function useAvatarEditor(): AvatarEditorControls {
  const { hasOwn, upload, remove } = useAvatarActions();
  const [editor, setEditor] = useState<AvatarEditor>(idleEditor);
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement>(null);
  const stepRan = useRef(false);

  // The controls are disabled while a step runs, and a removal deletes the
  // Remove button. Both drop focus, so give it back to the control that began
  // the step. Leave focus alone when the person has moved it to the page.
  useEffect(() => {
    if (editor.phase !== "idle") {
      stepRan.current = true;
      return;
    }
    if (!stepRan.current) return;
    stepRan.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
    const target = opener.current?.isConnected
      ? opener.current
      : document.getElementById(changePictureButtonId);
    target?.focus();
  }, [editor]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setEditor({ phase: "preparing" });
    try {
      const problem = await checkImageFile(file, AVATAR_SOURCE_MAX_BYTES);
      if (problem) {
        setEditor({ phase: "idle", error: problem });
        return;
      }
      const blob = await avatarBlob(file);
      setEditor({
        phase: "preview",
        draft: { blob, requestId: crypto.randomUUID() },
        error: "",
      });
    } catch (cause) {
      setEditor({ phase: "idle", error: errorMessage(cause) });
    }
  }

  async function save() {
    if (editor.phase !== "preview") return;
    const { draft } = editor;
    setEditor({ phase: "uploading", draft });
    try {
      await upload(draft.requestId, draft.blob);
      setEditor(idleEditor);
      toast.success("Profile picture updated.");
    } catch (cause) {
      setEditor(uploadFailed(cause, draft));
    }
  }

  async function removePicture() {
    if (editor.phase !== "confirmRemoval") return;
    setEditor({ phase: "removing" });
    try {
      await remove();
      setEditor(idleEditor);
      toast.success("Profile picture removed.");
    } catch (cause) {
      setEditor({ phase: "idle", error: errorMessage(cause) });
    }
  }

  return {
    editor,
    hasPicture: hasOwn,
    busy: editor.phase !== "idle",
    inputRef,
    pick: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      inputRef.current?.click();
    },
    choose,
    save,
    askRemove: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEditor({ phase: "confirmRemoval" });
    },
    cancel: () => {
      if (editor.phase === "preview" || editor.phase === "confirmRemoval") {
        setEditor(idleEditor);
      }
    },
    remove: removePicture,
  };
}
