import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiError } from "@/api/client";
import {
  commitHousekeepingStaffBulkUpload,
  downloadHousekeepingStaffBulkUploadTemplate,
  validateHousekeepingStaffBulkUpload,
} from "@/api/housekeepingStaff";
import { downloadSanctionedStrengthBulkUploadErrorReport } from "@/api/sanctionedStrength";
import type {
  BulkUploadRowStatus,
  HousekeepingStaffBulkUploadCommitResponse,
  HousekeepingStaffBulkUploadValidationResponse,
} from "@/api/types";
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

// Upload -> Validate preview -> Commit for HousekeepingStaff (Phase J,
// glowing-zooming-hamming.md), a sibling of
// components/sanctionedStrength/BulkUploadDialog.tsx and
// components/locations/LocationBulkUploadDialog.tsx (own row shape, own
// /housekeeping-staff/bulk-upload/* endpoints) -- see the Location sibling's
// own docstring for the fuller rationale (Dialog-not-route flow, reuse of
// the shared /error-report endpoint and its one cosmetic filename wart,
// component-placement choice). Placed in the pre-existing
// components/housekeepingStaff/ directory (already home to
// HousekeepingStaffFormDrawer) rather than a new folder, unlike Location
// which needed a fresh directory.

type RowStatusFilter = "ALL" | BulkUploadRowStatus;

const ROW_STATUS_FILTERS: { value: RowStatusFilter; label: string }[] = [
  { value: "ALL", label: "All rows" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "unchanged", label: "Unchanged" },
  { value: "rejected", label: "Rejected" },
];

// Mirrors HousekeepingStaffListPage.tsx's own SHIFT_LABELS.
const SHIFT_LABELS: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  NIGHT: "Night",
};

function PreviewTable({
  result,
  filter,
  onFilterChange,
}: {
  result: HousekeepingStaffBulkUploadValidationResponse;
  filter: RowStatusFilter;
  onFilterChange: (value: RowStatusFilter) => void;
}) {
  const visibleRows = filter === "ALL" ? result.rows : result.rows.filter((row) => row.status === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {result.total} rows: {result.created_count} created, {result.updated_count} updated,{" "}
          {result.unchanged_count} unchanged, {result.rejected_count} rejected.
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

      {/* overflow-x-auto too (unlike the Sanctioned Strength/Location
          preview tables) -- this row shape has more columns than fit
          comfortably in the dialog's own max-w-3xl. */}
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        {result.rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows in this file.</p>
        ) : visibleRows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows match this filter.</p>
        ) : (
          // Deliberately NOT the `Table` wrapper component here: it injects its
          // own `overflow-x-auto` div around the `<table>`, which forces that
          // div's computed overflow-y to `auto` too (CSS's overflow
          // visible/non-visible canonicalization rule) -- making IT, not this
          // outer `max-h-96 overflow-auto` div, the nearest ancestor scroll
          // container for `sticky` purposes, even though it never actually
          // scrolls itself. Confirmed live (Playwright, scrolling this exact
          // DOM shape with the app's real compiled CSS): with `Table`, the
          // sticky header scrolls away with the rows; with a plain `<table>`
          // here (this outer div's own `overflow-auto` already covers both
          // axes), it stays pinned correctly, matching this table's
          // pre-migration behavior.
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Bio ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Floor</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.row_number}>
                  <TableCell>{row.row_number}</TableCell>
                  <TableCell>
                    <BulkUploadRowStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>{row.campus_code ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{row.bio_id ?? "—"}</TableCell>
                  <TableCell>{row.name ?? "—"}</TableCell>
                  <TableCell>{row.designation_name ?? "—"}</TableCell>
                  <TableCell>{row.location_name ?? "—"}</TableCell>
                  <TableCell>{row.block ?? "—"}</TableCell>
                  <TableCell>{row.floor_venue ?? "—"}</TableCell>
                  <TableCell>{row.shift ? (SHIFT_LABELS[row.shift] ?? row.shift) : "—"}</TableCell>
                  <TableCell>{row.supervisor ?? "—"}</TableCell>
                  <TableCell className="text-destructive">{row.error_reason ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        )}
      </div>
    </div>
  );
}

export function HousekeepingStaffBulkUploadDialog() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<HousekeepingStaffBulkUploadValidationResponse | null>(
    null,
  );
  const [commitResult, setCommitResult] = useState<HousekeepingStaffBulkUploadCommitResponse | null>(null);
  const [filter, setFilter] = useState<RowStatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const templateMutation = useMutation({
    mutationFn: downloadHousekeepingStaffBulkUploadTemplate,
  });

  const validateMutation = useMutation({
    mutationFn: (f: File) => validateHousekeepingStaffBulkUpload(f),
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
    mutationFn: () => commitHousekeepingStaffBulkUpload(file as File),
    onSuccess: (data) => {
      setError(null);
      setCommitResult(data);
      setFilter("ALL");
      void queryClient.invalidateQueries({ queryKey: ["housekeeping-staff"] });
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk upload housekeeping staff</DialogTitle>
          <DialogDescription>
            Upload a filled-in workbook to preview created/updated/unchanged/rejected rows before committing. Rows
            are matched by Campus Code and Bio ID.
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
                Upload committed. {commitResult.created_count} created, {commitResult.updated_count} updated,{" "}
                {commitResult.unchanged_count} unchanged, {commitResult.rejected_count} rejected.
              </p>
              {commitResult.storage_warning ? (
                // Non-blocking -- the commit itself genuinely succeeded
                // (counts above are real); only the original workbook's
                // archival copy failed. See
                // app/services/storage.py::try_upload_bulk_upload_file's
                // own docstring.
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
