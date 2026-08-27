import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import {
  commitDesignationBulkUpload,
  downloadDesignationBulkUploadTemplate,
  validateDesignationBulkUpload,
} from "@/api/designations";
import { downloadSanctionedStrengthBulkUploadErrorReport } from "@/api/sanctionedStrength";
import type {
  DesignationBulkUploadCommitResponse,
  DesignationBulkUploadRowStatus,
  DesignationBulkUploadValidationResponse,
} from "@/api/types";
import { BulkUploadRowStatusBadge } from "@/components/sanctionedStrength/BulkUploadRowStatusBadge";
import { Badge } from "@/components/ui/badge";
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

// Upload -> Validate preview -> Commit for Designation (Designation Master
// production-hardening epic, backend Phase 1 / this frontend Phase 2) -- a
// sibling of components/departments/DepartmentBulkUploadDialog.tsx (same
// Dialog-not-route/no-server-side-caching-of-parsed-rows shape, same
// auto-validate-on-file-select flow; see that component's own docstring for
// the full rationale, which carries over here unchanged). Placed under a new
// components/designations/ directory rather than reusing components/departments/
// or components/sanctionedStrength/ -- own domain-specific upload flow (own
// row shape, own /designations/bulk-upload/* endpoints), matching this
// codebase's usual "one folder per backend resource domain" component
// convention.
//
// downloadSanctionedStrengthBulkUploadErrorReport is imported directly from
// api/sanctionedStrength.ts rather than duplicated here, same reuse
// DepartmentBulkUploadDialog relies on -- see that component's own docstring
// for the accepted, documented filename-mismatch wart this carries over
// (downloaded file is always named "sanctioned-strength-bulk-upload-{id}-
// errors.xlsx" locally, even though the backend's own header names it
// "designation-bulk-upload-{id}-errors.xlsx").

// Designation-only: includes "merged" (see DesignationBulkUploadRowStatus).
type RowStatusFilter = "ALL" | DesignationBulkUploadRowStatus;

// Cosmetic display-only formatting for the preview table's Category column --
// same convention as DepartmentBulkUploadDialog's own formatCategoryDisplay
// (NON_TEACHING -> "NON-TEACHING", never touching the persisted enum value).
function formatCategoryDisplay(category: string | null): string {
  if (!category) return "—";
  return category === "NON_TEACHING" ? "NON-TEACHING" : category.replace(/_/g, " ");
}

function formatDepartmentCodes(codes: string[]): string {
  return codes.length > 0 ? codes.join(", ") : "—";
}

function formatActive(isActive: boolean | null): string {
  if (isActive === null) return "—";
  return isActive ? "Active" : "Inactive";
}

const ROW_STATUS_FILTERS: { value: RowStatusFilter; label: string }[] = [
  { value: "ALL", label: "All rows" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "unchanged", label: "Unchanged" },
  { value: "merged", label: "Merged" },
  { value: "rejected", label: "Rejected" },
];

// "merged" is Designation-only, so the shared BulkUploadRowStatusBadge (typed
// to the shared 4-status vocabulary) is left untouched and simply delegated to
// for every other status -- same reasoning as the backend keeping its own
// DesignationBulkUploadRowStatus literal rather than widening the shared one.
function DesignationRowStatusBadge({ status }: { status: DesignationBulkUploadRowStatus }) {
  if (status === "merged") return <Badge variant="outline">Merged</Badge>;
  return <BulkUploadRowStatusBadge status={status} />;
}

function PreviewTable({
  result,
  filter,
  onFilterChange,
}: {
  result: DesignationBulkUploadValidationResponse;
  filter: RowStatusFilter;
  onFilterChange: (value: RowStatusFilter) => void;
}) {
  const visibleRows = filter === "ALL" ? result.rows : result.rows.filter((row) => row.status === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {result.total} rows: {result.created_count} created, {result.updated_count} updated,{" "}
          {result.unchanged_count} unchanged,{" "}
          {result.merged_count > 0 ? <>{result.merged_count} merged, </> : null}
          {result.rejected_count} rejected.
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
          // Deliberately NOT the `Table` wrapper component -- see
          // DepartmentBulkUploadDialog.tsx's own comment on this exact same
          // sticky-header-vs-`overflow-x-auto` interaction (commit ce3dad6).
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Department Codes</TableHead>
                <TableHead>Qualification</TableHead>
                <TableHead>Min. experience</TableHead>
                <TableHead>Employment type</TableHead>
                <TableHead>Required skills</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                // Fragment, not a single <TableRow>: a rejected/merged row's
                // explanation is rendered as its own full-width row directly
                // underneath. It used to be an 11th "Details" column, which
                // sat off the right edge behind a horizontal scrollbar -- the
                // single most important cell when something goes wrong was the
                // one the user could not see (reported 2026-08-27).
                <Fragment key={row.row_number}>
                <TableRow>
                  <TableCell>{row.row_number}</TableCell>
                  <TableCell>
                    <DesignationRowStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>{row.name ?? "—"}</TableCell>
                  <TableCell>{formatCategoryDisplay(row.category)}</TableCell>
                  <TableCell>{formatDepartmentCodes(row.department_codes)}</TableCell>
                  <TableCell>{row.qualification ?? "—"}</TableCell>
                  <TableCell>{row.min_experience ?? "—"}</TableCell>
                  <TableCell>{row.employment_type?.replace(/_/g, " ") ?? "—"}</TableCell>
                  <TableCell>{row.required_skills ?? "—"}</TableCell>
                  <TableCell>{formatActive(row.is_active)}</TableCell>
                </TableRow>
                {row.error_reason ? (
                  <TableRow>
                    <TableCell colSpan={10} className="pt-0 text-destructive">
                      {row.error_reason}
                    </TableCell>
                  </TableRow>
                ) : row.status === "merged" ? (
                  <TableRow>
                    <TableCell colSpan={10} className="pt-0 text-muted-foreground">
                      Same designation as row {row.merged_into_row} -- this row's department codes were combined
                      into it. Nothing was skipped.
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

export function DesignationBulkUploadDialog() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<DesignationBulkUploadValidationResponse | null>(null);
  const [commitResult, setCommitResult] = useState<DesignationBulkUploadCommitResponse | null>(null);
  const [filter, setFilter] = useState<RowStatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const templateMutation = useMutation({
    mutationFn: downloadDesignationBulkUploadTemplate,
  });

  const validateMutation = useMutation({
    mutationFn: (f: File) => validateDesignationBulkUpload(f),
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
    mutationFn: () => commitDesignationBulkUpload(file as File),
    onSuccess: (data) => {
      setError(null);
      setCommitResult(data);
      setFilter("ALL");
      void queryClient.invalidateQueries({ queryKey: ["designations"] });
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
          Bulk upload
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bulk upload designations</DialogTitle>
          <DialogDescription>
            Upload a filled-in workbook to preview every row before committing. Rows are matched by Designation
            Name and Category together -- both are required on every row. You can list a designation's departments
            either as several codes in one row's Department Codes cell, or as one row per department: rows sharing
            a Name and Category are combined, not rejected. The combined set then replaces that designation's
            existing linked departments. See the downloaded template for the exact column layout.
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
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
                Successfully imported {commitResult.created_count + commitResult.updated_count} designation
                {commitResult.created_count + commitResult.updated_count === 1 ? "" : "s"}.
              </p>
              <p className="text-sm text-muted-foreground">
                Upload committed. {commitResult.created_count} created, {commitResult.updated_count} updated,{" "}
                {commitResult.unchanged_count} unchanged, {commitResult.rejected_count} rejected.
              </p>
              {commitResult.storage_warning ? (
                // Non-blocking -- the row commit itself genuinely succeeded
                // (counts above are real); only the original workbook's
                // archival copy failed. See DepartmentBulkUploadDialog.tsx's
                // own comment on this exact distinction.
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
                  disabled={commitMutation.isPending || validationResult.total === 0}
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
