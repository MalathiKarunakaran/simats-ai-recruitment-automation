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
  /** "pill" (default, unchanged) is this component's original compact
   * rounded-full look -- every existing call site (Vacancy Requests,
   * Departments, Designations, Locations, Job Postings, Candidates,
   * Applications, Reports) keeps rendering this with no prop change
   * required. "segmented" is a bolder, more literal segmented-control
   * treatment (solid primary fill on the active segment, square-ish
   * corners) added for DashboardPage's category tabs redesign
   * (2026-08-23) -- an explicit per-call-site opt-in rather than a global
   * style change, per that ticket's own constraint that other CategoryTabs
   * consumers must not visually change. */
  variant?: "pill" | "segmented";
}

// Dependency-free (no @radix-ui/react-tabs in this repo) -- same
// local-state-and-styled-buttons approach as components/ui/accordion.tsx.
// Only drives which tab is selected; callers own what content renders.
export function Tabs<T extends string>({ value, onValueChange, tabs, className, variant = "pill" }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 border border-border bg-muted p-1",
        variant === "pill" ? "rounded-full" : "rounded-[var(--radius)] shadow-sm",
        className,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onValueChange(tab.value)}
          className={cn(
            "px-4 py-1.5 text-sm font-medium transition-all duration-200",
            variant === "pill" ? "rounded-full" : "rounded-[calc(var(--radius)-4px)] font-semibold",
            value === tab.value
              ? variant === "pill"
                ? "bg-card text-foreground shadow-sm"
                : "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
