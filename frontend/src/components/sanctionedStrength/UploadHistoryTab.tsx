import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  downloadSanctionedStrengthBulkUploadOriginalFile,
  listSanctionedStrengthBulkUploads,
} from "@/api/sanctionedStrength";
import type { BulkUploadLogRead } from "@/api/types";
import { UndoBulkUploadDialog } from "@/components/sanctionedStrength/UndoBulkUploadDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// "Upload history" tab (zany-snuggling-pie.md Phase F, item 5) -- lists past
// bulk-upload batches from GET /sanctioned-strength/bulk-uploads (gated
// SANCTIONED_STRENGTH_WRITE_ROLES server-side, same as every endpoint this
// tab calls -- SanctionedStrengthPage only renders this tab at all for
// canManage users, see the page's own gate).

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

export function UploadHistoryTab() {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sanctioned-strength-bulk-uploads", page],
    queryFn: () => listSanctionedStrengthBulkUploads({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const offset = data?.offset ?? page * PAGE_SIZE;
  const limit = data?.limit ?? PAGE_SIZE;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 text-table-header font-medium">Filename</th>
              <th className="px-3 py-2 text-table-header font-medium">Uploaded by</th>
              <th className="px-3 py-2 text-table-header font-medium">Uploaded at</th>
              <th className="px-3 py-2 text-table-header font-medium">Rows</th>
              <th className="px-3 py-2 text-table-header font-medium">Status</th>
              <th className="px-3 py-2 text-table-header font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-destructive">
                  {error instanceof ApiError ? error.message : "Failed to load upload history."}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-muted-foreground">
                  No bulk uploads yet.
                </td>
              </tr>
            ) : (
              rows.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="px-3 py-2 font-medium">{log.filename}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={log.uploaded_by_id}>
                    {log.uploaded_by_id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(log.uploaded_at).toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {log.rows_total} total ({log.rows_created} created, {log.rows_updated} updated,{" "}
                    {log.rows_rejected} rejected)
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={log.status === "UNDONE" ? "outline" : "success"}>
                      {log.status === "UNDONE" ? "Undone" : "Completed"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DownloadOriginalFileButton log={log} />
                      {isWithinUndoWindow(log) ? (
                        <UndoBulkUploadDialog
                          bulkUploadLogId={log.id}
                          filename={log.filename}
                          uploadedAt={log.uploaded_at}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
