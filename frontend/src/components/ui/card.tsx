import type * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // UI redesign Phase 1: softer, wider-blur "floating" shadow
        // (--shadow-card/--shadow-card-hover, index.css) replaces the flat
        // shadow-sm/hover:shadow-md pair, plus a subtle hover lift
        // (-translate-y-0.5) -- both shadow and transform now animate
        // together under one `transition-all` (widened from the previous
        // `transition-shadow`) so the lift doesn't visually lag the glow.
        // `motion-reduce:transition-none motion-reduce:hover:translate-y-0`
        // respects prefers-reduced-motion at the one call site that needs
        // it here; this codebase has no global reduced-motion rule yet
        // (grepped index.css/App -- none exists), which is a real gap but
        // out of scope to fix everywhere in this pass.
        "rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("font-display text-sm font-semibold tracking-wide text-muted-foreground", className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
