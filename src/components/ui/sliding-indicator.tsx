import { useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** The white raised pill that covers the active item of a segmented list. */
export const pillIndicator =
  "top-0 left-0 h-(--indicator-h) w-(--indicator-w) translate-x-(--indicator-x) translate-y-(--indicator-y) rounded-md bg-background shadow-sm"

const activeSelector = [
  '[data-state="active"]',
  '[aria-selected="true"]',
  '[aria-pressed="true"]',
  '[aria-current="page"]',
].join(",")

/**
 * A decorative marker that sits behind the active item of its parent and
 * slides to the next one when the active item changes. Render it as the first
 * child of a container that has `relative isolate`. The active item is the
 * first descendant with `data-state="active"`, `aria-selected`,
 * `aria-pressed` or `aria-current="page"`. The component reads the DOM, so
 * it works with Radix Tabs and with plain buttons, and it changes no role or
 * aria attribute.
 *
 * The marker slides only when another item becomes active. A resize, a font
 * swap or a new count inside a tab moves it without animation, so it never
 * lags behind its tab. The first placement does not animate either.
 *
 * Offsets, not bounding rectangles, give the position. An ancestor that is
 * scaling in, such as a dialog, then does not shift the marker.
 */
export function SlidingIndicator({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const marker = ref.current
    const list = marker?.parentElement
    if (!marker || !list) return
    let sittingOn: Element | null = null
    let geometry = ""

    const place = () => {
      const active = list.querySelector<HTMLElement>(activeSelector)
      if (!active || !active.offsetWidth) {
        sittingOn = null
        geometry = ""
        delete marker.dataset.placed
        return
      }
      const next = [
        active.offsetLeft,
        active.offsetTop,
        active.offsetWidth,
        active.offsetHeight,
      ]
      const key = next.join()
      if (key === geometry && active === sittingOn) return
      marker.dataset.slide = String(sittingOn !== null && sittingOn !== active)
      sittingOn = active
      geometry = key
      const [x, y, width, height] = next
      marker.style.setProperty("--indicator-x", `${x}px`)
      marker.style.setProperty("--indicator-y", `${y}px`)
      marker.style.setProperty("--indicator-w", `${width}px`)
      marker.style.setProperty("--indicator-h", `${height}px`)
      marker.dataset.placed = ""
    }

    const resize = new ResizeObserver(place)
    const watchItems = () => {
      resize.disconnect()
      resize.observe(list)
      for (const item of list.children) {
        if (item !== marker) resize.observe(item)
      }
    }
    const mutation = new MutationObserver(() => {
      watchItems()
      place()
    })
    mutation.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-selected", "aria-pressed", "aria-current"],
    })
    watchItems()
    place()
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [])

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="sliding-indicator"
      className={cn(
        "pointer-events-none absolute -z-10 opacity-0 data-[placed]:opacity-100 data-[slide=true]:transition-[translate,width,height] data-[slide=true]:duration-(--motion-base) data-[slide=true]:ease-out",
        className
      )}
    />
  )
}
