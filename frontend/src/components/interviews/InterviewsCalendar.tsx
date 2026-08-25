import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { InterviewScheduleRead } from "@/api/types";
import { STATUS_VARIANT } from "@/components/interviews/StatusBadge";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Local (not UTC) calendar-day key -- matches every other date display on
// this page (`new Date(interview.scheduled_at).toLocaleString()` etc.),
// which all render in the viewer's local timezone.
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface InterviewsCalendarProps {
  /** Already status/campus/search/"my interviews only"-filtered -- the exact
   * same array InterviewsListPage's own list view renders, just further
   * split out per-day within the visible month here. This component never
   * fetches or re-derives that filtering itself. */
  interviews: InterviewScheduleRead[];
  isLoading: boolean;
  /** Resolves the label shown on a day cell's chip -- the caller passes
   * whatever candidate/application lookups it already has fetched, so this
   * component never re-fetches data of its own. */
  resolveCandidateName: (interview: InterviewScheduleRead) => string;
}

/** Month-grid calendar view for the Interviews list page (7 columns
 * Sun-Sat, always full weeks so the grid stays rectangular). Deferred since
 * Step 6 of the earlier "UI refinement epic" -- see InterviewsListPage.tsx's
 * former comment -- now built per explicit user request (month-grid, not a
 * day-agenda or week-time-slot shape). */
export function InterviewsCalendar({ interviews, isLoading, resolveCandidateName }: InterviewsCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));
  const today = new Date();

  const interviewsByDay = useMemo(() => {
    const map = new Map<string, InterviewScheduleRead[]>();
    for (const interview of interviews) {
      const key = dayKey(new Date(interview.scheduled_at));
      const bucket = map.get(key);
      if (bucket) bucket.push(interview);
      else map.set(key, [interview]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }
    return map;
  }, [interviews]);

  const weeks = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay(); // 0 (Sun) - 6 (Sat)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Always a whole number of 7-day weeks, covering every day of the
    // month plus leading/trailing padding from the adjacent months.
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const gridStart = new Date(year, month, 1 - firstWeekday);

    const days: Date[] = Array.from({ length: totalCells }, (_, i) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      return day;
    });

    const result: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [currentMonth]);

  const monthLabel = currentMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous month"
            onClick={() => setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next month"
            onClick={() => setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        // Withhold the grid entirely while loading rather than risk
        // rendering a previous month's already-fetched chips against a
        // freshly-changed filter -- matches this page's existing
        // TableEmpty-loading convention.
        <div role="status" className="flex h-96 items-center justify-center rounded-lg border border-border bg-muted/30">
          <span className="animate-pulse text-sm text-muted-foreground">Loading interviews…</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {weeks.map((week, weekIndex) =>
              week.map((day, dayIndex) => {
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const isToday = isSameDay(day, today);
                // Padding days from the adjacent month never show chips --
                // an interview's scheduled_at only ever belongs to one real
                // calendar day.
                const dayInterviews = isCurrentMonth ? (interviewsByDay.get(dayKey(day)) ?? []) : [];
                return (
                  <div
                    key={dayKey(day)}
                    data-current-month={isCurrentMonth ? "true" : undefined}
                    data-today={isToday ? "true" : undefined}
                    className={cn(
                      "flex min-h-24 flex-col gap-1 border-b border-border p-1.5",
                      dayIndex !== 6 && "border-r",
                      weekIndex === weeks.length - 1 && "border-b-0",
                      !isCurrentMonth && "bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                        !isCurrentMonth && "text-muted-foreground opacity-60",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {dayInterviews.length > 0 ? (
                      // Bounded scroll, not a silent cap -- every interview
                      // for the day is in the DOM, just scrollable once the
                      // cell fills up (this repo has a zero-tolerance stance
                      // on silently dropping rows for layout reasons).
                      <div className="flex max-h-20 flex-col gap-0.5 overflow-y-auto">
                        {dayInterviews.map((interview) => (
                          <Link
                            key={interview.id}
                            to={`/interviews/${interview.id}`}
                            title={`${formatTime(interview.scheduled_at)} · ${resolveCandidateName(interview)}`}
                            className={cn(
                              badgeVariants({ variant: STATUS_VARIANT[interview.status] }),
                              "block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight hover:opacity-80",
                            )}
                          >
                            {formatTime(interview.scheduled_at)} {resolveCandidateName(interview)}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
