import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { importLegacyVacancies } from "@/api/migration";
import type { MigrationImportResponse } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CAN_IMPORT_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

const TEMPLATE_HEADERS = [
  "campus_code",
  "department_name",
  "position_title",
  "role_category",
  "employment_type",
  "requested_count",
  "qualification",
  "experience_required",
  "salary_band_min",
  "salary_band_max",
  "priority",
  "skills",
  "jd_draft",
];

const TEMPLATE_EXAMPLE_ROW = [
  "SSE",
  "Computer Science and Engineering",
  "Assistant Professor",
  "TEACHING",
  "FULL_TIME",
  "2",
  "PhD in Computer Science",
  "3+ years teaching experience",
  "",
  "",
  "NORMAL",
  "Machine Learning;Data Structures",
  "",
];

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS.join(",")}\n${TEMPLATE_EXAMPLE_ROW.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vacancy-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function VacancyImportPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<MigrationImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => importLegacyVacancies(file),
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
    return <p className="text-sm text-muted-foreground">Only an HR Admin or Super Admin can bulk-import vacancies.</p>;
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) importMutation.mutate(file);
    event.target.value = "";
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Import vacancies</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/vacancy-requests">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk CSV import</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Every imported row lands as a <span className="font-medium">DRAFT</span> vacancy request for human
            review — it still needs to go through the normal submit → dean-approve → HR-approve → publish chain.
            Required columns: {TEMPLATE_HEADERS.slice(0, 8).join(", ")}. Optional:{" "}
            {TEMPLATE_HEADERS.slice(8).join(", ")}.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              Download CSV template
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            <Button size="sm" disabled={importMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              {importMutation.isPending ? "Importing…" : "Upload CSV"}
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Import result: {result.created_count} created, {result.error_count} failed (of {result.total_rows}{" "}
              rows)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.row_number}>
                    <TableCell>{row.row_number}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "created" ? "success" : "destructive"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.status === "created" ? (
                        row.vacancy_request_id ? (
                          <Link to={`/vacancy-requests/${row.vacancy_request_id}`} className="hover:underline">
                            View request
                          </Link>
                        ) : null
                      ) : (
                        <ul className="list-disc pl-4 text-destructive">
                          {row.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
