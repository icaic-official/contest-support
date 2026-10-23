import { useSyncExternalStore } from "react";

/** The color theme that a person chooses. "system" follows the device. */
export type ThemePreference = "light" | "dark" | "system";

const storageKey = "minsky-theme";
const darkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function storedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Storage can be unavailable in private browsing; follow the device.
    return "system";
  }
}

function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

/** Adds or removes the `dark` class on the root element. */
export function applyTheme(): void {
  const dark = resolvedTheme(storedPreference()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia(darkQuery);
  const change = () => {
    applyTheme();
    listener();
  };
  media.addEventListener("change", change);
  window.addEventListener("storage", change);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", change);
    window.removeEventListener("storage", change);
  };
}

/** Saves the preference and updates every subscribed component. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, preference);
  } catch {
    // The choice then lasts only until the page reloads.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

/** Returns the saved preference and the theme that is in use now. */
export function useTheme(): {
  preference: ThemePreference;
  theme: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribe, storedPreference);
  const theme = useSyncExternalStore(subscribe, () =>
    resolvedTheme(storedPreference()),
  );
  return { preference, theme, setPreference: setThemePreference };
}
