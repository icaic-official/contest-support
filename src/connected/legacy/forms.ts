import type { FormEvent } from "react";

/** Stops the browser submission and returns the form fields. */
export function formData(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
export function text(data: FormData, name: string): string {
  return String(data.get(name) ?? "");
}
