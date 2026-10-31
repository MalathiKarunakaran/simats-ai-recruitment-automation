import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listSelectionBatches } from "@/api/selectionBatches";
import type { SelectionBatchStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { BATCH_STATUS_LABELS, BatchStatusBadge } from "@/components/talentPool/BatchStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 25;
const ALL = "__all__";
// Mirrors selection_batches.py: require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR).
const ALLOWED_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"];

function formatBatchDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function SelectionBatchesPage() {
  const { user } = useAuth();
  const allowed = !!user && ALLOWED_ROLES.includes(user.role);
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ["selection-batches", "list", status, offset],
    queryFn: () => listSelectionBatches({ status: status || null, limit: PAGE_SIZE, offset }),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (!allowed) {
    return <p className="text-sm text-muted-foreground">You are not allowed to view Selection Batches.</p>;
  }

  const data = query.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Selection Batches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lists of selected candidates sent to the University for approval.
        </p>
      </div>

      <Select
        value={status || ALL}
        onValueChange={(value) => {
          setStatus(value === ALL ? "" : value);
          setOffset(0);
        }}
      >
        <SelectTrigger aria-label="Status filter" className="h-8 w-52 text-xs">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {(Object.keys(BATCH_STATUS_LABELS) as SelectionBatchStatus[]).map((value) => (
            <SelectItem key={value} value={value}>{BATCH_STATUS_LABELS[value]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {query.isError ? (
        <p className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Could not load selection batches"}
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch no.</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Campus</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 ? <TableEmpty colSpan={5}>No selection batches yet.</TableEmpty> : null}
                {data?.items.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <Link to={`/selection-batches/${batch.id}`} className="font-medium text-brand-primary underline">
                        {batch.batch_no}
                      </Link>
                    </TableCell>
                    <TableCell>{formatBatchDate(batch.created_at)}</TableCell>
                    <TableCell className="tabular-nums">{batch.member_count}</TableCell>
                    <TableCell><BatchStatusBadge status={batch.status} /></TableCell>
                    <TableCell>{batch.campus_code ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && data.total > PAGE_SIZE ? (
        <Pagination total={data.total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} itemLabel="batches" />
      ) : null}
    </div>
  );
}
