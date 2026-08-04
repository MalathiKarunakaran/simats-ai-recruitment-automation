import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AccordionItemProps {
  open: boolean;
  onToggle: () => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}

// Dependency-free (no @radix-ui/react-accordion in this repo) -- uses the
// CSS grid-template-rows 0fr/1fr trick to animate height:auto smoothly
// without measuring pixel heights in JS.
export function AccordionItem({ open, onToggle, trigger, children, className }: AccordionItemProps) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-sm", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-accent/40"
      >
        {trigger}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="border-t border-border p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
