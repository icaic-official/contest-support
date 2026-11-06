import { useEffect, useState } from "react";

const textFields =
  'textarea, select, input:not([type="radio"], [type="checkbox"], [type="file"], [type="button"], [type="submit"])';

/**
 * True while a text field has focus, and while focus moves to another
 * control of the same form, such as Send. An on-screen keyboard is then
 * likely open and the page hides its tab bar. The bar returns when focus
 * leaves the form. Staying hidden for Send keeps the button from moving
 * between the press and the release.
 */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.matches(textFields)) setTyping(true);
      else if (!event.target.closest("form")) setTyping(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const from = event.target instanceof Element ? event.target.closest("form") : null;
      const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest("form") : null;
      if (!from || from !== to) setTyping(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return typing;
}
