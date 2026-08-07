import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { downloadTrackerTemplate, importTrackerWorkbook } from "@/api/migration";
import { ApiError } from "@/api/client";
import type { TrackerImportResponse } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CAN_IMPORT_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

// Import runs can carry hundreds of rows -- a status filter on each result
// table lets HR jump straight to what needs review (flagged/warning) rather
// than scrolling past every already-clean imported row. Independent of the
// header counts above each table, which always reflect the full run.
type RowStatusFilter = "ALL" | "imported" | "imported_with_warning" | "flagged";

const ROW_STATUS_FILTERS: { value: RowStatusFilter; label: string }[] = [
  { value: "ALL", label: "All rows" },
  { value: "imported", label: "Imported" },
  { value: "imported_with_warning", label: "Imported (warning)" },
  { value: "flagged", label: "Flagged" },
];

function RowStatusBadge({ status }: { status: string }) {
  if (status === "flagged") return <Badge variant="destructive">flagged</Badge>;
  if (status === "imported_with_warning") return <Badge variant="warning">imported (warning)</Badge>;
  return <Badge variant="success">imported</Badge>;
}

function RowStatusFilterSelect({
  value,
  onValueChange,
  ariaLabel,
}: {
  value: RowStatusFilter;
  onValueChange: (v: RowStatusFilter) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as RowStatusFilter)}>
      <SelectTrigger aria-label={ariaLabel} className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROW_STATUS_FILTERS.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TrackerImportPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<TrackerImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeSample, setIncludeSample] = useState(false);
  const [vacancyStatusFilter, setVacancyStatusFilter] = useState<RowStatusFilter>("ALL");
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<RowStatusFilter>("ALL");

  const downloadMutation = useMutation({
    mutationFn: downloadTrackerTemplate,
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not download the template"),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importTrackerWorkbook(file, includeSample),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      setVacancyStatusFilter("ALL");
      setCandidateStatusFilter("ALL");
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Import failed");
    },
  });

  if (!user || !CAN_IMPORT_ROLES.includes(user.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only an HR Admin or Super Admin can import the recruitment tracker workbook.
      </p>
    );
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) importMutation.mutate(file);
    event.target.value = "";
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Import recruitment tracker</h1>
        <p className="text-sm text-muted-foreground">
          Loads the real, currently-manual SIMATS recruitment tracker workbook as live data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workbook import</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            <span className="font-medium">Vacancy Tracker</span> rows land as already-published vacancies with real
            hiring slots (these are ongoing drives, not new requests awaiting approval).{" "}
            <span className="font-medium">Candidate Pipeline</span> rows land as applications with their real
            current status. Safe to re-run whenever the workbook is updated — rows are matched by their own Request
            ID / Candidate ID and updated in place, never duplicated. Any row that doesn&apos;t match the fixed
            Campus / Staff Category / Source / Status lists is flagged with a reason, not silently dropped.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={downloadMutation.isPending}
              onClick={() => downloadMutation.mutate()}
            >
              {downloadMutation.isPending ? "Downloading…" : "Download workbook template"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button size="sm" disabled={importMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              {importMutation.isPending ? "Importing…" : "Upload filled-in workbook"}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={includeSample}
              onChange={(e) => setIncludeSample(e.target.checked)}
            />
            Include the template&apos;s sample row (for a test/demo import, not real data)
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          {(() => {
            const visibleVacancyRows =
              vacancyStatusFilter === "ALL"
                ? result.vacancy_rows
                : result.vacancy_rows.filter((row) => row.status === vacancyStatusFilter);
            const visibleCandidateRows =
              candidateStatusFilter === "ALL"
                ? result.candidate_rows
                : result.candidate_rows.filter((row) => row.status === candidateStatusFilter);
            return (
              <>
                <Card>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle>
                      Vacancy Tracker: {result.vacancy_imported_count} imported, {result.vacancy_flagged_count}{" "}
                      flagged (of {result.vacancy_total_rows} rows)
                    </CardTitle>
                    {result.vacancy_rows.length > 0 ? (
                      <RowStatusFilterSelect
                        value={vacancyStatusFilter}
                        onValueChange={setVacancyStatusFilter}
                        ariaLabel="Vacancy Tracker status filter"
                      />
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    {result.vacancy_rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No rows to import.</p>
                    ) : visibleVacancyRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No rows match this filter.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 font-medium">Row</th>
                            <th className="py-2 font-medium">Status</th>
                            <th className="py-2 font-medium">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleVacancyRows.map((row) => (
                            <tr key={row.row_number} className="border-b border-border last:border-0">
                              <td className="py-2">{row.row_number}</td>
                              <td className="py-2">
                                <RowStatusBadge status={row.status} />
                              </td>
                              <td className="py-2">
                                {row.status !== "flagged" && row.vacancy_request_id ? (
                                  <div className="flex flex-col gap-1">
                                    <Link
                                      to={`/vacancy-requests/${row.vacancy_request_id}`}
                                      className="hover:underline"
                                    >
                                      View vacancy
                                    </Link>
                                    {row.status === "imported_with_warning" && row.errors.length > 0 ? (
                                      <ul className="list-disc pl-4 text-brand-warning">
                                        {row.errors.map((e, i) => (
                                          <li key={i}>{e}</li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>
                                ) : (
                                  <ul className="list-disc pl-4 text-destructive">
                                    {row.errors.map((e, i) => (
                                      <li key={i}>{e}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle>
                      Candidate Pipeline: {result.candidate_imported_count} imported,{" "}
                      {result.candidate_flagged_count} flagged (of {result.candidate_total_rows} rows)
                    </CardTitle>
                    {result.candidate_rows.length > 0 ? (
                      <RowStatusFilterSelect
                        value={candidateStatusFilter}
                        onValueChange={setCandidateStatusFilter}
                        ariaLabel="Candidate Pipeline status filter"
                      />
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    {result.candidate_rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No rows to import.</p>
                    ) : visibleCandidateRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No rows match this filter.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 font-medium">Row</th>
                            <th className="py-2 font-medium">Status</th>
                            <th className="py-2 font-medium">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleCandidateRows.map((row) => (
                            <tr key={row.row_number} className="border-b border-border last:border-0">
                              <td className="py-2">{row.row_number}</td>
                              <td className="py-2">
                                <RowStatusBadge status={row.status} />
                              </td>
                              <td className="py-2">
                                {row.status !== "flagged" && row.application_id ? (
                                  <Link to={`/applications/${row.application_id}`} className="hover:underline">
                                    View application
                                  </Link>
                                ) : null}
                                {row.errors.length > 0 ? (
                                  <ul className="list-disc pl-4 text-destructive">
                                    {row.errors.map((e, i) => (
                                      <li key={i}>{e}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </>
      ) : null}
    </div>
  );
}
