import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { commitLocationBulkUpload, downloadLocationBulkUploadTemplate, validateLocationBulkUpload } from "@/api/locations";
import { downloadSanctionedStrengthBulkUploadErrorReport } from "@/api/sanctionedStrength";
import type {
  BulkUploadRowStatus,
  LocationBulkUploadCommitResponse,
  LocationBulkUploadValidationResponse,
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

// Upload -> Validate preview -> Commit for Location (Phase J,
// glowing-zooming-hamming.md), a sibling of
// components/sanctionedStrength/BulkUploadDialog.tsx (that component's own
// Phase F docstring explains the overall Dialog-not-route/no-server-side-
// caching-of-parsed-rows shape, which carries over here unchanged). Placed
// under a new components/locations/ directory rather than reusing
// components/sanctionedStrength/ -- this is Location's own domain-specific
// upload flow (own row shape, own /locations/bulk-upload/* endpoints), so it
// follows this codebase's usual "one folder per backend resource domain"
// component convention (see frontend skill doc) rather than living under a
// different entity's folder just because that's where the *first* bulk-
// upload flow happened to be built.
//
// downloadSanctionedStrengthBulkUploadErrorReport is imported directly from
// api/sanctionedStrength.ts rather than duplicated here -- its
// `/sanctioned-strength/bulk-upload/{id}/error-report` endpoint already
// dispatches on `BulkUploadLog.entity_type` server-side (see that router's
// own module docstring) and works unchanged for a Location batch's id. One
// accepted, cosmetic-only wart from this reuse: the downloaded file is
// always named "sanctioned-strength-bulk-upload-{id}-errors.xlsx" locally
// (apiFetchBlob doesn't expose the response's real Content-Disposition
// filename -- see that function's own docstring), even though the backend's
// own header names it "location-bulk-upload-{id}-errors.xlsx". Not fixed
// here: doing so would mean either duplicating this download function 3x
// just to vary a local filename string, or teaching apiFetchBlob to read
// response headers (a bigger, cross-cutting change out of this phase's
// scope) -- an accepted, documented trade-off, not an oversight.

type RowStatusFilter = "ALL" | BulkUploadRowStatus;

const ROW_STATUS_FILTERS: { value: RowStatusFilter; label: string }[] = [
  { value: "ALL", label: "All rows" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "unchanged", label: "Unchanged" },
  { value: "rejected", label: "Rejected" },
];

function PreviewTable({
  result,
  filter,
  onFilterChange,
}: {
  result: LocationBulkUploadValidationResponse;
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

      <div className="max-h-96 overflow-y-auto rounded-md border border-border">
        {result.rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows in this file.</p>
        ) : visibleRows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No rows match this filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Campus</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Block</th>
                <th className="px-3 py-2 font-medium">Floor</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.row_number} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{row.row_number}</td>
                  <td className="px-3 py-2">
                    <BulkUploadRowStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2">{row.campus_code ?? "—"}</td>
                  <td className="px-3 py-2">{row.location_name ?? "—"}</td>
                  <td className="px-3 py-2">{row.block_building ?? "—"}</td>
                  <td className="px-3 py-2">{row.floor_venue ?? "—"}</td>
                  <td className="px-3 py-2">{row.category ? row.category.replace(/_/g, " ") : "—"}</td>
                  <td className="px-3 py-2 text-destructive">{row.error_reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function LocationBulkUploadDialog() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<LocationBulkUploadValidationResponse | null>(null);
  const [commitResult, setCommitResult] = useState<LocationBulkUploadCommitResponse | null>(null);
  const [filter, setFilter] = useState<RowStatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const templateMutation = useMutation({
    mutationFn: downloadLocationBulkUploadTemplate,
  });

  const validateMutation = useMutation({
    mutationFn: (f: File) => validateLocationBulkUpload(f),
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
    mutationFn: () => commitLocationBulkUpload(file as File),
    onSuccess: (data) => {
      setError(null);
      setCommitResult(data);
      setFilter("ALL");
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk upload locations</DialogTitle>
          <DialogDescription>
            Upload a filled-in workbook to preview created/updated/unchanged/rejected rows before committing. Rows
            are matched by Campus Code and Location Name.
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
              <p className="text-sm font-medium text-brand-success">Upload committed.</p>
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
