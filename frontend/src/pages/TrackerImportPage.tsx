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

const CAN_IMPORT_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

function RowStatusBadge({ status }: { status: string }) {
  if (status === "flagged") return <Badge variant="destructive">flagged</Badge>;
  if (status === "imported_with_warning") return <Badge variant="warning">imported (warning)</Badge>;
  return <Badge variant="success">imported</Badge>;
}

export function TrackerImportPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<TrackerImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeSample, setIncludeSample] = useState(false);

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
          <Card>
            <CardHeader>
              <CardTitle>
                Vacancy Tracker: {result.vacancy_imported_count} imported, {result.vacancy_flagged_count} flagged
                (of {result.vacancy_total_rows} rows)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.vacancy_rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rows to import.</p>
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
                    {result.vacancy_rows.map((row) => (
                      <tr key={row.row_number} className="border-b border-border last:border-0">
                        <td className="py-2">{row.row_number}</td>
                        <td className="py-2">
                          <RowStatusBadge status={row.status} />
                        </td>
                        <td className="py-2">
                          {row.status === "imported" && row.vacancy_request_id ? (
                            <Link to={`/vacancy-requests/${row.vacancy_request_id}`} className="hover:underline">
                              View vacancy
                            </Link>
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
            <CardHeader>
              <CardTitle>
                Candidate Pipeline: {result.candidate_imported_count} imported, {result.candidate_flagged_count}{" "}
                flagged (of {result.candidate_total_rows} rows)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.candidate_rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rows to import.</p>
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
                    {result.candidate_rows.map((row) => (
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
      ) : null}
    </div>
  );
}
