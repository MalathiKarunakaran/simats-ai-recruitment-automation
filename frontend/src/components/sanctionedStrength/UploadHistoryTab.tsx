import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  downloadSanctionedStrengthBulkUploadOriginalFile,
  listSanctionedStrengthBulkUploads,
} from "@/api/sanctionedStrength";
import type { BulkUploadEntityType, BulkUploadLogRead } from "@/api/types";
import { UndoBulkUploadDialog } from "@/components/sanctionedStrength/UndoBulkUploadDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// "Upload history" tab/dialog (zany-snuggling-pie.md Phase F, item 5).
// Generalized in Phase J (glowing-zooming-hamming.md) to serve Location and
// HousekeepingStaff batches too, via the new required `entityType` prop --
// SanctionedStrengthPage renders this inside its own "Upload history" Tab
// (a genuine section of that page); LocationsPage/HousekeepingStaffListPage
// instead each wrap it in a plain Dialog opened from a "Upload history"
// button, since neither of those pages has a Tabs section of its own to add
// a third tab to. Lists past bulk-upload batches from
// GET /sanctioned-strength/bulk-uploads (the shared, entity-agnostic
// endpoint -- see that router's own module docstring), filtered to this one
// `entityType` so e.g. a Location upload never bleeds into the Sanctioned
// Strength page's own history view now that all 3 entities share this one
// batch log table. Role-gating is the caller's job (each page's own
// canManage, mirroring that page's _WRITE_ROLES) -- this component doesn't
// re-check it.

const PAGE_SIZE = 20;

function isWithinUndoWindow(log: BulkUploadLogRead): boolean {
  return log.status === "COMPLETED" && new Date() < new Date(log.undo_deadline);
}

function DownloadOriginalFileButton({ log }: { log: BulkUploadLogRead }) {
  const downloadMutation = useMutation({
    mutationFn: () => downloadSanctionedStrengthBulkUploadOriginalFile(log.id, log.filename),
  });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={downloadMutation.isPending}
      onClick={() => downloadMutation.mutate()}
    >
      {downloadMutation.isPending ? "Downloading…" : "Download original file"}
    </Button>
  );
}

export interface UploadHistoryTabProps {
  entityType: BulkUploadEntityType;
}

export function UploadHistoryTab({ entityType }: UploadHistoryTabProps) {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, error } = useQuery({
    // entityType is part of the query key (not just the queryFn's own
    // params) so switching entities -- e.g. this same component instance
    // being reused across pages in tests -- never serves a stale, wrongly-
    // scoped cache entry.
    queryKey: ["sanctioned-strength-bulk-uploads", entityType, page],
    queryFn: () =>
      listSanctionedStrengthBulkUploads({ entity_type: entityType, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const offset = data?.offset ?? page * PAGE_SIZE;
  const limit = data?.limit ?? PAGE_SIZE;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Uploaded at</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableEmpty colSpan={6} loading />
            ) : isError ? (
              <TableEmpty colSpan={6} className="text-destructive">
                {error instanceof ApiError ? error.message : "Failed to load upload history."}
              </TableEmpty>
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={6}>No bulk uploads yet.</TableEmpty>
            ) : (
              rows.map((log) => (
                <TableRow key={log.id} className="align-top">
                  <TableCell className="font-medium">{log.filename}</TableCell>
                  <TableCell className="text-muted-foreground" title={log.uploaded_by_id}>
                    {log.uploaded_by_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(log.uploaded_at).toLocaleString()}</TableCell>
                  <TableCell className="tabular-nums">
                    {log.rows_total} total ({log.rows_created} created, {log.rows_updated} updated,{" "}
                    {log.rows_rejected} rejected)
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === "UNDONE" ? "outline" : "success"}>
                      {log.status === "UNDONE" ? "Undone" : "Completed"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DownloadOriginalFileButton log={log} />
                      {isWithinUndoWindow(log) ? (
                        <UndoBulkUploadDialog
                          bulkUploadLogId={log.id}
                          filename={log.filename}
                          uploadedAt={log.uploaded_at}
                          entityType={entityType}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Showing {showingFrom}–{showingTo} of {total} uploads
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
