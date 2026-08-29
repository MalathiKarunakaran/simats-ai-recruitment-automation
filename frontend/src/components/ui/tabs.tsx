import { cn } from "@/lib/utils";

// Per-tab semantic tone (Sanctioned Strength colour pass, 2026-08-29).
// Entirely optional: a tab that omits `accent` renders exactly as it always
// has, which is what every other Tabs/CategoryTabs consumer in the app does.
export type TabAccent = "blue" | "purple" | "orange";

const TAB_ACCENT_DOT: Record<TabAccent, string> = {
  blue: "bg-brand-primary",
  purple: "bg-brand-purple",
  orange: "bg-brand-warning",
};

// Applied to the ACTIVE tab only -- an inactive accented tab keeps the
// standard muted-foreground treatment so the strip doesn't turn into a row
// of competing colours (brief: "too many colors" is an explicit anti-goal).
const TAB_ACCENT_ACTIVE: Record<TabAccent, string> = {
  blue: "text-brand-primary",
  purple: "text-brand-purple",
  orange: "text-brand-warning",
};

export interface TabOption<T extends string> {
  value: T;
  label: string;
  /** Optional semantic tone -- renders a small colour dot before the label
   * and tints the label when this tab is active. Omit for the default look. */
  accent?: TabAccent;
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
            // The segmented variant fills the active tab with --primary, so
            // an accent tint on top of it would be unreadable -- accents are
            // applied to the pill variant only.
            tab.accent && variant === "pill" && value === tab.value && TAB_ACCENT_ACTIVE[tab.accent],
          )}
        >
          {tab.accent ? (
            <span
              aria-hidden="true"
              className={cn(
                "mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle transition-opacity",
                TAB_ACCENT_DOT[tab.accent],
                value === tab.value ? "opacity-100" : "opacity-50",
              )}
            />
          ) : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
