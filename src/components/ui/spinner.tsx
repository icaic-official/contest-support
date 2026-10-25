import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A spinning icon for a wait. It is decorative: put the status text next to
 * it. Give it a size class. A Button sizes the icons inside it. The
 * reduced-motion rule in `src/index.css` stops the spin.
 */
function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden="true"
      className={cn("animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
