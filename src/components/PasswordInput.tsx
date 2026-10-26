import { type ComponentProps, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a show/hide button. The field starts hidden. The
 * choice lives in this component only, so it does not persist.
 */
export function PasswordInput({
  id,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "id"> & { id: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={shown ? "text" : "password"}
        className={cn("pr-12", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 -translate-y-1/2"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
