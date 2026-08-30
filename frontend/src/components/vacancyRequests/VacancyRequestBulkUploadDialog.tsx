import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { downloadSanctionedStrengthBulkUploadErrorReport } from "@/api/sanctionedStrength";
import type {
  VacancyRequestBulkUploadCommitResponse,
  VacancyRequestBulkUploadValidationResponse,
} from "@/api/types";
import {
  commitVacancyRequestBulkUpload,
  downloadVacancyRequestBulkUploadTemplate,
  validateVacancyRequestBulkUpload,
} from "@/api/vacancyRequests";
import { BulkUploadRowStatusBadge } from "@/components/sanctionedStrength/BulkUploadRowStatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Upload -> Validate preview -> Commit for Vacancy Requests (2026-08-30),
// a sibling of components/locations/LocationBulkUploadDialog.tsx. Follows this
// codebase's one-dialog-per-domain convention rather than abstracting a shared
// component -- the same call the Location and Department dialogs made.
//
// The row-status filter here offers only Created and Rejected. This importer
// is CREATE-ONLY (a vacancy request is an event, not master data -- see
// app/services/vacancy_request_import.py), so "Updated" and "Unchanged"
// filters would be permanently empty options that imply behaviour the backend
// cannot produce.
//
// downloadSanctionedStrengthBulkUploadErrorReport is reused directly rather
// than duplicated: that endpoint dispatches on BulkUploadLog.entity_type
// server-side and works unchanged for a VACANCY_REQUEST batch. Same accepted
// cosmetic wart the Location dialog documents -- the locally saved filename
// says "sanctioned-strength" because apiFetchBlob cannot read the response's
// Content-Disposition.

type RowStatusFilter = "ALL" | "created" | "rejected";

const ROW_STATUS_FILTERS: { value: RowStatusFilter; label: string }[] = [
  { value: "ALL", label: "All rows" },
  { value: "created", label: "Created" },
  { value: "rejected", label: "Rejected" },
];

function PreviewTable({
  result,
  filter,
  onFilterChange,
}: {
  result: VacancyRequestBulkUploadValidationResponse;
  filter: RowStatusFilter;
  onFilterChange: (value: RowStatusFilter) => void;
}) {
  const visibleRows = filter === "ALL" ? result.rows : result.rows.filter((row) => row.status === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Created/rejected only -- updated and unchanged are structurally
            always 0 here, so printing them would suggest this importer can
            do something it deliberately cannot. */}
        <p className="text-sm text-muted-foreground">
          {result.total} rows: {result.created_count} created, {result.rejected_count} rejected.
        </p>
        {result.rows.length > 0 ? (
          <div className="w-48">
            <Select value={filter} onValueChange={(v) => onFilterChange(v as RowStatusFilter)}>
              <SelectTrigger aria-label="Bulk upload row status filter">
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
          </div>
        ) : null}
      </div>

      <div className="max-h-96 overflow-y-auto rounded-md border border-border">
        {result.rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows in this file.</p>
        ) : visibleRows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows match this filter.</p>
        ) : (
          // Plain <table>, not the Table wrapper -- see the Location dialog's
          // own note: the wrapper's overflow-x-auto div becomes the nearest
          // scroll container and the sticky header scrolls away with it.
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Positions</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                // Fragment: a rejected row's reason gets its own full-width
                // row underneath rather than a trailing column hidden behind
                // a horizontal scrollbar -- the fix applied across every
                // bulk-upload dialog on 2026-08-27.
                <Fragment key={row.row_number}>
                  <TableRow>
                    <TableCell>{row.row_number}</TableCell>
                    <TableCell>
                      <BulkUploadRowStatusBadge status={row.status as "created" | "rejected"} />
                    </TableCell>
                    <TableCell>{row.campus_code ?? "—"}</TableCell>
                    <TableCell>{row.department_name ?? "—"}</TableCell>
                    <TableCell>{row.designation_name ?? "—"}</TableCell>
                    <TableCell>{row.requested_count ?? "—"}</TableCell>
                    <TableCell>{row.priority ?? "—"}</TableCell>
                  </TableRow>
                  {row.error_reason ? (
                    <TableRow>
                      <TableCell colSpan={7} className="pt-0 text-destructive">
                        {row.error_reason}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </table>
        )}
      </div>
    </div>
  );
}

export function VacancyRequestBulkUploadDialog() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<VacancyRequestBulkUploadValidationResponse | null>(null);
  const [commitResult, setCommitResult] = useState<VacancyRequestBulkUploadCommitResponse | null>(null);
  const [filter, setFilter] = useState<RowStatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const templateMutation = useMutation({ mutationFn: downloadVacancyRequestBulkUploadTemplate });

  const validateMutation = useMutation({
    mutationFn: (f: File) => validateVacancyRequestBulkUpload(f),
    onSuccess: (data) => {
      setError(null);
      setValidationResult(data);
      setCommitResult(null);
      setFilter("ALL");
    },
    onError: (err) => {
      setValidationResult(null);
      setError(err instanceof ApiError ? err.message : "Validation failed");
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => commitVacancyRequestBulkUpload(file as File),
    onSuccess: (data) => {
      setError(null);
      setCommitResult(data);
      setFilter("ALL");
      void queryClient.invalidateQueries({ queryKey: ["vacancy-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["sanctioned-strength-bulk-uploads"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Commit failed"),
  });

  const errorReportMutation = useMutation({
    mutationFn: (bulkUploadLogId: string) => downloadSanctionedStrengthBulkUploadErrorReport(bulkUploadLogId),
  });

  function resetFlow() {
    setFile(null);
    setValidationResult(null);
    setCommitResult(null);
    setFilter("ALL");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetFlow();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setCommitResult(null);
    validateMutation.mutate(selected);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Bulk upload requests
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk upload vacancy requests</DialogTitle>
          <DialogDescription>
            Upload a filled-in workbook to preview which rows will be created before committing. Every valid row
            becomes a new DRAFT request — nothing is matched against existing requests, because two identical rows
            are two genuine requests. Submit them for approval afterwards from the list below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={templateMutation.isPending}
              onClick={() => templateMutation.mutate()}
            >
              {templateMutation.isPending ? "Downloading…" : "Download template"}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileChange} />
            <Button
              type="button"
              size="sm"
              disabled={validateMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {validateMutation.isPending ? "Validating…" : file ? "Choose a different file" : "Choose file"}
            </Button>
            {file ? <span className="text-sm text-muted-foreground">{file.name}</span> : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {commitResult ? (
            <>
              <p className="text-sm font-medium text-brand-success">
                Upload committed. {commitResult.created_count} draft request
                {commitResult.created_count === 1 ? "" : "s"} created, {commitResult.rejected_count} rejected.
              </p>
              {commitResult.storage_warning ? (
                // Non-blocking: the rows genuinely committed, only the
                // workbook's archival copy failed. Deliberately not styled
                // as an error.
                <p className="rounded-md border border-brand-warning/30 bg-brand-warning/10 px-3 py-2 text-sm text-brand-warning">
                  {commitResult.storage_warning}
                </p>
              ) : null}
              <PreviewTable result={commitResult} filter={filter} onFilterChange={setFilter} />
              <DialogFooter className="justify-between sm:justify-between">
                {commitResult.rejected_count > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={errorReportMutation.isPending}
                    onClick={() => errorReportMutation.mutate(commitResult.bulk_upload_log_id)}
                  >
                    {errorReportMutation.isPending ? "Downloading…" : "Download error report"}
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="button" variant="outline" onClick={resetFlow}>
                  Upload another file
                </Button>
              </DialogFooter>
            </>
          ) : validationResult ? (
            <>
              <PreviewTable result={validationResult} filter={filter} onFilterChange={setFilter} />
              <DialogFooter>
                <Button
                  type="button"
                  disabled={commitMutation.isPending || validationResult.created_count === 0}
                  onClick={() => commitMutation.mutate()}
                >
                  {commitMutation.isPending ? "Committing…" : "Commit"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
