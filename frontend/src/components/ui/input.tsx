import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
