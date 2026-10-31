import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";

import { downloadFlaggedRows, listSheetSyncRuns } from "@/api/sheetSync";
import type { SheetSyncRun } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SourceCard {
  code: string;
  label: string;
  /** Where it comes from, shown small under the name. */
  sheet: string;
  // Backend source strings that feed this card (first match wins).
  sources: string[];
  waiting?: boolean;
}

const CARDS: SourceCard[] = [
  { code: "S1", label: "Teaching Applicants", sheet: "Final tab", sources: ["TALENT_POOL_TEACHING_FINAL", "TEACHING_FINAL"] },
  { code: "S2", label: "Non-Teaching Applicants", sheet: "NTS tab", sources: ["TALENT_POOL_NTS", "NTS"] },
  { code: "S3", label: "New Joinees", sheet: "New Joinees tab", sources: ["NEW_JOINEES"] },
  { code: "S4", label: "Provisional Orders", sheet: "Pro App Order tab", sources: ["PRO_APP_ORDER"] },
  { code: "S5", label: "New Departments", sheet: "New Departments sheet", sources: [], waiting: true },
];

const PRIMARY_COUNTS = ["received", "inserted", "updated", "unchanged", "deactivated", "flagged"];

const COUNT_LABELS: Record<string, string> = {
  received: "Received",
  inserted: "Inserted",
  updated: "Updated",
  unchanged: "Unchanged",
  deactivated: "Deactivated",
  flagged: "Flagged",
  reactivated: "Reactivated",
  skipped: "Skipped",
  duplicates: "Duplicates",
  not_in_employees: "Not in Employees",
  linked_talent_pool: "Linked to talent pool",
  linked_joinee: "Linked to joinee",
  unlinked: "Unlinked",
};

function countLabel(key: string): string {
  if (COUNT_LABELS[key]) return COUNT_LABELS[key];
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const absoluteFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatWhen(value: string | null): string {
  if (!value) return "time unknown";
  const date = new Date(value);
  return `${relativeTime(date)} (${absoluteFormat.format(date)} IST)`;
}

function CountsGrid({ counts }: { counts: Record<string, number> }) {
  const extra = Object.keys(counts).filter((k) => !PRIMARY_COUNTS.includes(k));
  const keys = [...PRIMARY_COUNTS.filter((k) => k in counts), ...extra];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {keys.map((key) => (
        <div key={key} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{countLabel(key)}</dt>
          <dd className="text-lg font-semibold tabular-nums">{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

function SyncCard({ card, runs }: { card: SourceCard; runs: { last_run: SheetSyncRun | null; last_dry_run: SheetSyncRun | null } | null }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = (
    <div>
      <CardTitle className="text-base">{card.label}</CardTitle>
      <p className="mt-0.5 text-xs text-muted-foreground">from the {card.sheet}</p>
    </div>
  );

  if (card.waiting) {
    return (
      <Card>
        <CardHeader>{title}</CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Waiting for mapping approval — not synced yet.</p>
        </CardContent>
      </Card>
    );
  }

  const run = runs?.last_run ?? null;
  const dry = runs?.last_dry_run ?? null;
  const flagged = run?.counts.flagged ?? 0;

  async function onDownload(id: string) {
    setDownloading(true);
    setError(null);
    try {
      await downloadFlaggedRows(id);
    } catch {
      setError("Could not download the flagged rows.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardContent className="space-y-3">
        {run ? (
          <>
            <p className="text-sm text-muted-foreground">Last sync: {formatWhen(run.created_at)}</p>
            <CountsGrid counts={run.counts} />
            {run.missing_headers.length > 0 && (
              <div role="alert" className="rounded-lg border border-brand-warning/40 bg-brand-warning/10 px-3 py-2 text-sm text-brand-warning dark:text-[#ffcc80]">
                Missing headers in the sheet: {run.missing_headers.join(", ")}
              </div>
            )}
            {run.id && flagged > 0 && (
              <Button variant="outline" size="sm" disabled={downloading} onClick={() => void onDownload(run.id!)}>
                <Download className="size-4" />
                Download flagged rows
              </Button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not synced yet</p>
        )}
        {dry && (
          <p className="text-xs text-muted-foreground">
            Last dry run: {formatWhen(dry.created_at)} — {dry.counts.received ?? 0} received, {dry.counts.flagged ?? 0} flagged
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SheetSyncPage() {
  const { user } = useAuth();
  // Mirrors sheet_sync.py: GET /sheet-sync/runs is require_roles(SUPER_ADMIN).
  const allowed = user?.role === "SUPER_ADMIN";
  const query = useQuery({ queryKey: ["sheet-sync-runs"], queryFn: listSheetSyncRuns, enabled: allowed });

  if (!allowed) {
    return <p className="text-sm text-muted-foreground">You are not allowed to view Data Sync Status. This page is for Super Admins only.</p>;
  }

  const bySource = new Map((query.data ?? []).map((item) => [item.source, item]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Data Sync Status</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Syncs run automatically every 15 minutes from the Google Apps Script. A dry run is started from the script's
          previewJoineeSheets. This page is read-only.
        </p>
      </div>
      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.isError && <p className="text-sm text-destructive">Could not load sync status.</p>}
      {query.data && (
        <div className="space-y-4">
          {CARDS.map((card) => {
            const key = card.sources.find((s) => bySource.has(s));
            return <SyncCard key={card.code} card={card} runs={key ? bySource.get(key)! : null} />;
          })}
        </div>
      )}
    </div>
  );
}
