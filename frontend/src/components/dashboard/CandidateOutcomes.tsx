import { Link } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CandidateOutcomeCounts {
  selected: number;
  joined: number;
  waitlisted: number;
  rejected: number;
  withdrawn: number;
}

// Key-screens redesign (2026-10-29): the mock-up's "Candidate outcomes" row.
// Every figure comes from the dashboard KPI response the page already has --
// Selected and Joined from application_pipeline_funnel, the rest from their
// own counts -- so nothing here is computed twice.
const TILES: { key: keyof CandidateOutcomeCounts; label: string; tone: string; to?: string }[] = [
  { key: "selected", label: "Selected", tone: "bg-brand-success/10 text-[#14532d] dark:text-green-300" },
  { key: "joined", label: "Joined", tone: "bg-brand-primary-light text-[#1e3a8a] dark:bg-accent dark:text-accent-foreground" },
  {
    key: "waitlisted",
    label: "Waiting list",
    tone: "bg-brand-purple/10 text-[#4c1d95] dark:text-purple-300",
    to: "/rejected-waiting-list",
  },
  { key: "rejected", label: "Rejected", tone: "bg-brand-danger/10 text-[#7f1d1d] dark:text-red-300" },
  { key: "withdrawn", label: "Withdrawn", tone: "bg-muted text-foreground" },
];

export function CandidateOutcomes({ counts, isLoading }: { counts: CandidateOutcomeCounts; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader className="p-5 pb-2">
        <CardTitle className="font-display text-base">Candidate outcomes</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 p-5 pt-2 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map(({ key, label, tone, to }) => {
          const body = (
            <>
              <span className="text-sm">{label}</span>
              <span className="font-display text-2xl font-extrabold tabular-nums">
                {isLoading ? "—" : counts[key].toLocaleString()}
              </span>
            </>
          );
          const className = cn("flex flex-col gap-1 rounded-lg px-4 py-3", tone);
          return to ? (
            <Link key={key} to={to} className={cn(className, "transition-opacity hover:opacity-90")}>
              {body}
            </Link>
          ) : (
            <div key={key} className={className}>
              {body}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
