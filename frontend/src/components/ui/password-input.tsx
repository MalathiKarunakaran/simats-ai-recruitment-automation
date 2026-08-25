import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Show/hide toggle for password fields (2026-08-25) -- a shared primitive so
// every password input in the app (login, settings, set-new-password, admin
// user create/reset) gets the same behavior instead of 7 copies of the same
// relative-div + absolutely-positioned-button markup. Owns `type` itself
// (toggling "password"/"text" on its own state) -- callers never pass `type`.
// Visibility is local, uncontrolled state: it naturally resets to hidden
// whenever the input unmounts (e.g. LoginPage's mode switch conditionally
// unmounts the whole password form), with no reset prop needed from callers.

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

export { PasswordInput };
