import { Link } from "react-router-dom";

import type { TalentPoolOutcomeCounts } from "@/api/dashboard";
import { SHEET_FILTER_NOTE } from "@/components/dashboard/JoiningPipelineTiles";
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
// One row per category (2026-11-09): Teaching and Non-teaching each show the
// app figure from /kpis plus the matching sheet tab (Final / NTS), and the
// two categories are never added together. Withdrawn has no sheet part.
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

export interface OutcomeRow {
  key: string;
  label: string;
  app: CandidateOutcomeCounts;
  /** Null when the caller may not see sheet data: the row then shows app
   * numbers only, with no split line. */
  sheet: TalentPoolOutcomeCounts | null;
}

const SHEET_KEY: Record<keyof CandidateOutcomeCounts, keyof TalentPoolOutcomeCounts | null> = {
  selected: "selected",
  joined: "joined",
  waitlisted: "waiting_list",
  rejected: "rejected",
  withdrawn: null,
};

export function CandidateOutcomes({ rows, isLoading }: { rows: OutcomeRow[]; isLoading: boolean }) {
  const showsSheet = rows.some((row) => row.sheet !== null);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 p-3 pb-1">
        <CardTitle className="font-display text-base">Candidate outcomes</CardTitle>
        {showsSheet ? (
          <p className="text-xs font-normal text-muted-foreground" title={SHEET_FILTER_NOTE}>
            Numbers include the Google Sheet (Talent Pool) and the app. Hover a number for the split.
          </p>
        ) : null}
      </CardHeader>
      {/* Compact (2026-11-09): Teaching and Non-teaching sit side by side at
          laptop width so the card stays one row tall. */}
      <CardContent className="grid grid-cols-1 gap-x-4 gap-y-2 p-3 pt-1 lg:grid-cols-2">
        {rows.map((row) => (
          <section key={row.key} aria-label={row.label} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-muted-foreground">{row.label}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {TILES.map(({ key, label, tone, to }) => {
                const sheetKey = SHEET_KEY[key];
                const sheetCount = row.sheet && sheetKey ? row.sheet[sheetKey] : null;
                // The sheet/app split is on hover (2026-11-09): as a printed line
                // under every number it made the card hard to read.
                const split =
                  !isLoading && sheetCount !== null
                    ? `${(row.app[key] + sheetCount).toLocaleString()} = ${sheetCount.toLocaleString()} from the sheet + ${row.app[key].toLocaleString()} from the app`
                    : undefined;
                const body = (
                  <>
                    <span className="text-xs">{label}</span>
                    <span className="font-display text-2xl leading-tight font-extrabold tabular-nums">
                      {isLoading ? "—" : (row.app[key] + (sheetCount ?? 0)).toLocaleString()}
                    </span>
                  </>
                );
                const className = cn("flex min-w-0 flex-col rounded-lg px-3 py-2", tone);
                return to ? (
                  <Link key={key} to={to} title={split} className={cn(className, "transition-opacity hover:opacity-90")}>
                    {body}
                  </Link>
                ) : (
                  <div key={key} title={split} className={className}>
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
