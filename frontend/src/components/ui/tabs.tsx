import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  tabs: TabOption<T>[];
  className?: string;
}

// Dependency-free (no @radix-ui/react-tabs in this repo) -- same
// local-state-and-styled-buttons approach as components/ui/accordion.tsx.
// Only drives which tab is selected; callers own what content renders.
export function Tabs<T extends string>({ value, onValueChange, tabs, className }: TabsProps<T>) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-muted p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onValueChange(tab.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            value === tab.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
