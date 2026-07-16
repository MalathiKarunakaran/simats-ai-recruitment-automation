import type * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
