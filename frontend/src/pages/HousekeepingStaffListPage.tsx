import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listCampuses } from "@/api/campuses";
import { listDesignations } from "@/api/designations";
import { deleteHousekeepingStaff, exportHousekeepingStaff, listHousekeepingStaff } from "@/api/housekeepingStaff";
import { listLocations } from "@/api/locations";
import { GLOBAL_SCOPE_ROLES, HOUSEKEEPING_STAFF_MANAGEMENT_ROLES, type HousekeepingStaffRead } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";
import { HousekeepingStaffBulkUploadDialog } from "@/components/housekeepingStaff/HousekeepingStaffBulkUploadDialog";
import { HousekeepingStaffFormDrawer } from "@/components/housekeepingStaff/HousekeepingStaffFormDrawer";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";

// Bare list page (glowing-zooming-hamming.md Phase D) -- sufficient to
// live-verify the roster CRUD + HousekeepingStaffFormDrawer, deliberately
// NOT the full location-grouped operational view (Location/Block/
// Floor-Venue/Required/Available/Vacancy/Shift rows, click-to-expand
// roster) -- that's Phase G's job, per the plan's explicit scope note.
// Table shape/filters mirror LocationsPage.tsx (search/campus-filter/active
// filter/Add+Edit+Delete), the closest sibling master-data page.

const SHIFT_LABELS: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  NIGHT: "Night",
};

// Base columns: Name, Bio ID, Designation, Location, Block, Shift, Supervisor, Status.
// Campus and Actions are each conditionally shown (canFilterByCampus / canManage).
const BASE_COLUMN_COUNT = 8;

export function HousekeepingStaffListPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HousekeepingStaffRead | null>(null);
  // Phase J (glowing-zooming-hamming.md) -- same "Dialog, not a page Tab"
  // choice as LocationsPage's own historyDialogOpen (see that page's own
  // comment for why): this page has no Tabs section to extend either.
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  const [search, setSearch] = useState("");

  const { data: staff, isLoading } = useQuery({
    queryKey: ["housekeeping-staff"],
    queryFn: listHousekeepingStaff,
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: designations } = useQuery({
    queryKey: ["designations", "HOUSEKEEPING"],
    queryFn: () => listDesignations({ category: "HOUSEKEEPING" }),
  });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations });

  const canManage = Boolean(user && HOUSEKEEPING_STAFF_MANAGEMENT_ROLES.includes(user.role));
  // Mirrors LocationsPage/ActivityLogPage's own canFilterByCampus gate --
  // app/core/deps.py's GLOBAL_SCOPE_ROLES.
  const canFilterByCampus = Boolean(user && GLOBAL_SCOPE_ROLES.includes(user.role));

  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));
  const designationById = new Map((designations ?? []).map((d) => [d.id, d]));
  const locationById = new Map((locations ?? []).map((l) => [l.id, l]));

  const filtersActive =
    campusFilter !== "ALL" || activeFilter !== "true" || search.trim() !== "";

  const visibleStaff = (staff ?? [])
    .filter((s) => campusFilter === "ALL" || s.campus_id === campusFilter)
    .filter((s) => activeFilter === "ALL" || (activeFilter === "true" ? s.is_active : !s.is_active))
    .filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.bio_id.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  function openCreateDrawer() {
    setEditingRecord(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(record: HousekeepingStaffRead) {
    setEditingRecord(record);
    setDrawerOpen(true);
  }

  function afterSave() {
    void queryClient.invalidateQueries({ queryKey: ["housekeeping-staff"] });
  }

  // Mirrors the on-screen filters, so the workbook matches what is displayed.
  // Staff-visible (backend gate is `_staff_only`), not canManage-gated --
  // reading data out is not a write.
  const exportMutation = useMutation({
    mutationFn: () =>
      exportHousekeepingStaff({
        campusId: campusFilter === "ALL" ? null : campusFilter,
        search: search.trim() || null,
        isActive: activeFilter === "ALL" ? null : activeFilter === "true",
      }),
  });

  if (!user || user.role === "CANDIDATE") {
    return <p className="text-sm text-muted-foreground">Only staff can view Housekeeping Staff.</p>;
  }

  // Defined once as an element rather than a nested component: a component
  // declared inside render is a fresh type every pass and would remount (and
  // lose its pending state) on each keystroke in the filters above.
  const exportButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={exportMutation.isPending}
      onClick={() => exportMutation.mutate()}
    >
      {exportMutation.isPending ? "Exporting…" : "Export"}
    </Button>
  );


  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Housekeeping Staff"
        description="The Housekeeping staff roster -- Bio ID, designation, location, block/floor, shift, and supervisor, per staff member."
        actions={
          canManage ? (
            <>
              {/* Phase J (glowing-zooming-hamming.md) -- gated on the same
                  canManage (HOUSEKEEPING_STAFF_MANAGEMENT_ROLES) check as
                  Add staff/Edit/Delete below, mirroring the backend's own
                  _WRITE_ROLES gate on /housekeeping-staff/bulk-upload/*. */}
              <HousekeepingStaffBulkUploadDialog />
              <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    Upload history
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Housekeeping staff bulk upload history</DialogTitle>
                  </DialogHeader>
                  <UploadHistoryTab entityType="HOUSEKEEPING_STAFF" />
                </DialogContent>
              </Dialog>
              <Button onClick={openCreateDrawer}>Add staff</Button>
              {exportButton}
            </>
          ) : (
            exportButton
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or Bio ID"
          aria-label="Search housekeeping staff"
          className="sm:max-w-xs"
        />
        {canFilterByCampus ? (
          <Select value={campusFilter} onValueChange={setCampusFilter}>
            <SelectTrigger aria-label="Campus filter" className="sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All campuses</SelectItem>
              {(campuses ?? []).map((campus) => (
                <SelectItem key={campus.id} value={campus.id}>
                  {campus.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as "ALL" | "true" | "false")}>
          <SelectTrigger aria-label="Active filter" className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Bio ID</TableHead>
                {canFilterByCampus ? <TableHead>Campus</TableHead> : null}
                <TableHead>Designation</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty
                  colSpan={BASE_COLUMN_COUNT + (canFilterByCampus ? 1 : 0) + (canManage ? 1 : 0)}
                  loading
                />
              ) : visibleStaff.length === 0 ? (
                <TableEmpty colSpan={BASE_COLUMN_COUNT + (canFilterByCampus ? 1 : 0) + (canManage ? 1 : 0)}>
                  {filtersActive ? "No housekeeping staff match the current filters." : "No housekeeping staff found."}
                </TableEmpty>
              ) : (
                visibleStaff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.bio_id}</TableCell>
                    {canFilterByCampus ? (
                      <TableCell className="font-mono text-xs">{campusById.get(s.campus_id)?.code ?? "—"}</TableCell>
                    ) : null}
                    <TableCell>{designationById.get(s.designation_id)?.name ?? "—"}</TableCell>
                    <TableCell>{locationById.get(s.location_id)?.name ?? "—"}</TableCell>
                    <TableCell>{s.block ?? "—"}</TableCell>
                    <TableCell>{SHIFT_LABELS[s.shift] ?? s.shift}</TableCell>
                    <TableCell>{s.supervisor ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.is_active ? "success" : "destructive"}>
                        {s.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => openEditDrawer(s)}>
                            Edit
                          </Button>
                          <DeleteConfirmDialog
                            triggerAriaLabel={`Delete housekeeping staff ${s.name}`}
                            title="Delete housekeeping staff"
                            description={
                              <>
                                Remove <span className="font-medium text-foreground">{s.name}</span>? This is a
                                soft delete -- the record stays visible (as Inactive) and can be reactivated
                                later.
                              </>
                            }
                            onDelete={() => deleteHousekeepingStaff(s.id)}
                            onDeleted={() =>
                              void queryClient.invalidateQueries({ queryKey: ["housekeeping-staff"] })
                            }
                          />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <HousekeepingStaffFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        record={editingRecord}
        canChooseCampus={canFilterByCampus}
        defaultCampusId={canFilterByCampus ? "" : (user.campus_id ?? "")}
        onSaved={afterSave}
      />
    </div>
  );
}
