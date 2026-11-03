import { parseEventCode, type EventCode } from "../backend/contracts";

/** The browser storage key of the last event code that signed in on this device. */
export const eventCodeStorageKey = "minsky-event-code";

/** Undefined when the device has no code, or when storage is unavailable. */
export function rememberedEventCode(): EventCode | undefined {
  try {
    return parseEventCode(window.localStorage.getItem(eventCodeStorageKey) ?? "");
  } catch {
    return undefined;
  }
}

export function rememberEventCode(code: EventCode): void {
  try {
    window.localStorage.setItem(eventCodeStorageKey, code);
  } catch {
    // Without storage, the next sign-in starts with an empty code.
  }
}
