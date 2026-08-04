import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Serves two contexts (deliberately kept as one component rather than two
// near-duplicates): the compact horizontal-scroll KPI strip above the
// Vacancy Requests list (summary only, non-interactive, `urgent`/
// `lastRequestDate` omitted), and the larger navigable grid item introduced
// for the Department-accordion restructure (all fields, clickable, shows a
// `selected` state) -- see VacancyRequestsListPage.tsx for both call sites.
export interface DepartmentSummary {
  departmentId: string;
  departmentName: string;
  total: number;
  pending: number;
  approved: number;
  filled: number;
  required: number;
  urgent?: number;
  lastRequestDate?: string | null;
}

interface DepartmentSummaryCardProps {
  summary: DepartmentSummary;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

// Completion % is filled / required across every vacancy request in this
// department -- required is the sum of requested_count, not just approved
// ones, so a department with a lot of still-DRAFT/pending demand correctly
// shows a low percentage rather than dividing by a smaller approved-only base.
export function DepartmentSummaryCard({ summary, onClick, selected, className }: DepartmentSummaryCardProps) {
  const completionPct = summary.required > 0 ? Math.round((summary.filled / summary.required) * 100) : 0;
  const showExtendedStats = summary.urgent !== undefined || summary.lastRequestDate !== undefined;

  const content = (
    <>
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
        <CardTitle className="text-sm font-semibold text-foreground normal-case tracking-normal">
          {summary.departmentName}
        </CardTitle>
        {summary.urgent ? <Badge variant="destructive">{summary.urgent} urgent</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium tabular-nums">{summary.total}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Pending</dt>
            <dd className="font-medium tabular-nums">{summary.pending}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Approved</dt>
            <dd className="font-medium tabular-nums">{summary.approved}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Filled</dt>
            <dd className="font-medium tabular-nums">{summary.filled}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-semibold text-primary">{completionPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.min(completionPct, 100)}%` }}
            />
          </div>
        </div>
        {showExtendedStats ? (
          <p className="text-xs text-muted-foreground">
            Last request: {summary.lastRequestDate ? new Date(summary.lastRequestDate).toLocaleDateString() : "—"}
          </p>
        ) : null}
      </CardContent>
    </>
  );

  if (onClick) {
    return (
      <Card
        className={cn(
          "w-full shrink-0 cursor-pointer text-left transition-colors",
          selected && "border-primary ring-1 ring-primary",
          className,
        )}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {content}
      </Card>
    );
  }

  return <Card className={cn("min-w-56 shrink-0", className)}>{content}</Card>;
}
