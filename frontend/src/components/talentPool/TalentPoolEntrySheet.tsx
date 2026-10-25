import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { getTalentPoolEntry } from "@/api/talentPool";
import type { TalentPoolEntryRead, TalentPoolSourceTab } from "@/api/types";
import { eligibilityTone, statusTone, toneVariant } from "@/components/talentPool/statusTone";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * One pool entry, opened from a register row (spec 1.6).
 *
 * Read-only, deliberately and visibly: there is no form, no save, and no
 * field here is an input. The "All columns" section renders the entry's
 * `raw` object -- every column of the sheet row as header and value -- so a
 * column nobody modelled is still readable by a person instead of being
 * silently dropped on the way in.
 */

interface TalentPoolEntrySheetProps {
  entry: TalentPoolEntryRead | null;
  tab: TalentPoolSourceTab;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value ?? <span className="text-muted-foreground">&mdash;</span>}</dd>
    </div>
  );
}

function renderRawValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function TalentPoolEntrySheet({ entry, tab, onClose }: TalentPoolEntrySheetProps) {
  // The list response omits `raw`, so the full row is fetched on open. The
  // list row already on screen is used until it arrives, which keeps the
  // sheet from flashing empty.
  const detailQuery = useQuery({
    queryKey: ["talent-pool", "entry", entry?.id],
    queryFn: () => getTalentPoolEntry(entry!.id),
    enabled: Boolean(entry),
  });

  const detail = detailQuery.data;
  const shown = detail ?? entry;
  const teaching = tab === "TEACHING_FINAL";

  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent>
        {shown ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {shown.full_name}
                {!shown.is_active ? <Badge variant="warning">Removed from sheet</Badge> : null}
                {shown.application_id ? <Badge variant="info">In pipeline</Badge> : null}
              </SheetTitle>
            </SheetHeader>

            <SheetBody>
              <dl className="divide-y divide-border">
                <Field label="Email" value={shown.email} />
                <Field label="Phone" value={shown.phone} />
                <Field
                  label="Department"
                  value={
                    shown.dept_group || shown.dept_raw ? (
                      <>
                        {shown.dept_group ?? shown.dept_raw}
                        {shown.dept_raw && shown.dept_raw !== shown.dept_group ? (
                          <span className="block text-[11px] text-muted-foreground">
                            as typed: {shown.dept_raw}
                          </span>
                        ) : null}
                      </>
                    ) : null
                  }
                />
                {teaching ? (
                  <Field
                    label="Eligibility"
                    value={
                      shown.eligibility ? (
                        <>
                          <Badge variant={toneVariant(eligibilityTone(shown.eligibility))}>
                            {shown.eligibility}
                          </Badge>
                          {shown.eligibility_raw && shown.eligibility_raw !== shown.eligibility ? (
                            <span className="block text-[11px] text-muted-foreground">
                              as typed: {shown.eligibility_raw}
                            </span>
                          ) : null}
                        </>
                      ) : null
                    }
                  />
                ) : (
                  <Field label="Applied post" value={shown.applied_post} />
                )}
                <Field
                  label="Status"
                  value={
                    <>
                      <Badge variant={toneVariant(statusTone(shown.sheet_status))}>
                        {shown.sheet_status}
                      </Badge>
                      {shown.status_from_remark ? (
                        <span className="block text-[11px] text-muted-foreground">
                          read from a remark, not a status cell
                        </span>
                      ) : null}
                    </>
                  }
                />
                <Field label={teaching ? "Applied" : "Call / mail sent"} value={shown.applied_on} />
                {teaching ? <Field label="Interview" value={shown.interview_on_raw} /> : null}
                {teaching ? <Field label="Called by" value={shown.called_by} /> : null}
                <Field label="Source" value={shown.source} />
                <Field label="Remarks" value={shown.remarks} />
                <Field
                  label="Resume"
                  value={
                    // Only an https link is offered. The sheet's resume cell
                    // often holds a note rather than a URL, and rendering
                    // that as a dead link would look like a broken file.
                    shown.resume_url?.startsWith("https://") ? (
                      <a
                        href={shown.resume_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-primary underline"
                      >
                        Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      shown.resume_url
                    )
                  }
                />
                <Field
                  label="Sheet row"
                  value={shown.sheet_row_number ? `Sheet row ${shown.sheet_row_number}` : null}
                />
              </dl>

              <div className="mt-4">
                <h3 className="mb-1 text-xs font-semibold">All columns</h3>
                {detailQuery.isLoading ? (
                  <p className="text-[11px] text-muted-foreground">Loading the sheet row\u2026</p>
                ) : detail && Object.keys(detail.raw).length > 0 ? (
                  <dl className="divide-y divide-border">
                    {Object.entries(detail.raw).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 py-1 text-[11px]">
                        <dt className="text-muted-foreground break-words">{key}</dt>
                        <dd className="min-w-0 break-words">{renderRawValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No sheet columns were stored for this row.
                  </p>
                )}
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
