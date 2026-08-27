import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Plus, X } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import {
  createDepartment,
  deleteDepartment,
  exportDepartments,
  listDepartmentParentGroups,
  listDepartmentsWithCounts,
  updateDepartment,
  type DepartmentSortBy,
  type DepartmentSortDirection,
} from "@/api/departments";
import { DEPARTMENT_MANAGEMENT_ROLES, type DepartmentRead, type StaffRoleCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { CategoryBadge } from "@/components/domain/CategoryBadge";
import { DepartmentBulkUploadDialog } from "@/components/departments/DepartmentBulkUploadDialog";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CategoryTabs, mapServerCategoryCounts } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

const DEFAULT_LIMIT = 50;

interface FormState {
  campusId: string;
  code: string;
  category: StaffRoleCategory | "";
  parentGroup: string;
  description: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  campusId: "",
  code: "",
  category: "",
  parentGroup: "",
  description: "",
  isActive: true,
};

interface ColumnDef {
  key: string;
  label: string;
  sortBy: DepartmentSortBy;
}

// Every column here doubles as the sortable set -- unlike SanctionedStrengthPage
// (which has 2 non-sortable status columns alongside its sortable ones),
// every column departments.py::_SORT_FIELDS exposes has a direct table
// column, so there's no plain/non-clickable header case to handle.
const COLUMNS: ColumnDef[] = [
  { key: "campus", label: "Campus", sortBy: "campus" },
  { key: "name", label: "Name", sortBy: "name" },
  { key: "code", label: "Code", sortBy: "code" },
  { key: "category", label: "Category", sortBy: "category" },
  { key: "parent_group", label: "Parent group", sortBy: "parent_group" },
  { key: "is_active", label: "Status", sortBy: "is_active" },
];

// 3-dot row-actions Popover (Edit, Delete) -- same shape as
// UserDetailPage.tsx's own "More actions" menu, adapted per-row. Split into
// its own component (rather than inlined in the .map() below) so it can own
// its own Popover open state independently per row.
function DepartmentRowActions({
  department,
  onEdit,
  onChanged,
}: {
  department: DepartmentRead;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Kept as a sibling of <Popover>, NOT nested inside <PopoverContent> --
  // Radix's Popover unmounts its whole content subtree on close (no exit
  // animation is defined for it in this app), which would destroy
  // DeleteConfirmDialog's own internal open-state (and its Dialog Portal)
  // the instant the "Delete" row action closes this popover, before the
  // confirm dialog could ever render. Using DeleteConfirmDialog's
  // fully-controlled mode (`open`/`onOpenChange`, no `trigger`) instead
  // keeps the Dialog itself outside that unmounting subtree -- see that
  // component's own docstring on this exact pitfall.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const toast = useToast();

  // "Restore" reactivates a soft-deleted department -- reuses the existing
  // PATCH endpoint (no new backend route needed), same as flipping the
  // Active Select in the Edit dialog, just one click from the row menu.
  // Mutually exclusive with Delete: an already-inactive row only offers
  // Restore, an active row only offers Delete -- no point offering to
  // delete something already soft-deleted.
  const restoreMutation = useMutation({
    mutationFn: () => updateDepartment(department.id, { is_active: true }),
    onSuccess: () => {
      toast.success(`${department.name} restored.`);
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to restore department"),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={`More actions for ${department.name}`}>
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          <div className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </Button>
            {department.is_active ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start text-destructive hover:text-destructive"
                onClick={() => {
                  setOpen(false);
                  setDeleteOpen(true);
                }}
              >
                Delete
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={restoreMutation.isPending}
                onClick={() => {
                  setOpen(false);
                  restoreMutation.mutate();
                }}
              >
                {restoreMutation.isPending ? "Restoring…" : "Restore"}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        triggerAriaLabel={`Delete department ${department.name}`}
        title="Delete department"
        description={
          <>
            Remove <span className="font-medium text-foreground">{department.name}</span>? This is a soft
            delete -- the department stays visible (as Inactive) and can be reactivated later.
            <br />
            <span className="mt-2 block">
              Note: if this department still has active staff or designations assigned to it, the delete will
              be blocked until those are reassigned or deactivated first.
            </span>
          </>
        }
        onDelete={() => deleteDepartment(department.id)}
        onDeleted={onChanged}
      />
    </>
  );
}

export function DepartmentsPage() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Department name is required"));
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<DepartmentSortBy>("name");
  const [sortDir, setSortDir] = useState<DepartmentSortDirection>("asc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // Parent Group filter -- backend addition alongside GET
  // /departments/parent-groups (see api/departments.ts). Options are
  // populated from that endpoint's real, distinct, non-null values rather
  // than a hardcoded list.
  const [parentGroupFilter, setParentGroupFilter] = useState<string>("ALL");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryTab, setCategoryTab] = useCategoryTabState();
  // Defaults to Active-only -- inactive/leftover departments shouldn't
  // clutter the list while real data is still being entered; still
  // reachable via this filter, just not shown by default.
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  // searchInput tracks every keystroke; search (the value actually sent to
  // the server) only updates on blur/Enter -- this is now a server-side
  // filter (unlike the client-side-filtered search box this page had
  // before), so committing on every keystroke would fire a request per key.
  // Same convention as SanctionedStrengthPage's own search box.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: [
      "departments",
      limit,
      offset,
      sortBy,
      sortDir,
      campusFilter,
      categoryTab,
      activeFilter,
      search,
      parentGroupFilter,
    ],
    queryFn: () =>
      listDepartmentsWithCounts({
        limit,
        offset,
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_id: campusFilter === "ALL" ? null : campusFilter,
        category: categoryTab === "ALL" ? null : categoryTab,
        is_active: activeFilter === "ALL" ? null : activeFilter === "true",
        search: search.trim() || null,
        parent_group: parentGroupFilter === "ALL" ? null : parentGroupFilter,
      }),
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: parentGroups } = useQuery({
    queryKey: ["department-parent-groups"],
    queryFn: listDepartmentParentGroups,
  });

  // Bug fix: OR'd with hasPermission("MANAGE_DEPARTMENTS") -- backend's
  // departments.py gates create/update/delete/bulk-upload via require_permission,
  // not a role list, so an individually-granted permission must also unlock
  // this page's write controls (same pattern as UsersListPage's canManage).
  const canManage = Boolean(
    user && (DEPARTMENT_MANAGEMENT_ROLES.includes(user.role) || hasPermission?.("MANAGE_DEPARTMENTS")),
  );

  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));

  const departments = data?.items ?? [];
  const total = data?.total ?? 0;

  const filtersActive =
    campusFilter !== "ALL" ||
    categoryTab !== "ALL" ||
    activeFilter !== "true" ||
    search.trim() !== "" ||
    parentGroupFilter !== "ALL";

  function clearFilters() {
    setCampusFilter("ALL");
    setCategoryTab("ALL");
    setActiveFilter("true");
    setSearchInput("");
    setSearch("");
    setParentGroupFilter("ALL");
    setOffset(0);
  }

  function commitSearch() {
    setSearch(searchInput);
    setOffset(0);
  }

  function handleSort(column: ColumnDef) {
    if (sortBy === column.sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column.sortBy);
      setSortDir("asc");
    }
    setOffset(0);
  }

  const exportMutation = useMutation({
    mutationFn: () =>
      exportDepartments({
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_id: campusFilter === "ALL" ? null : campusFilter,
        category: categoryTab === "ALL" ? null : categoryTab,
        is_active: activeFilter === "ALL" ? null : activeFilter === "true",
        search: search.trim() || null,
        parent_group: parentGroupFilter === "ALL" ? null : parentGroupFilter,
      }),
  });

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    setEditingId(null);
    void queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  function buildPayload() {
    return {
      name: name.value,
      code: form.code.trim() || null,
      category: form.category || null,
      parent_group: form.parentGroup.trim() || null,
      description: form.description.trim() || null,
      is_active: form.isActive,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => createDepartment({ campus_id: form.campusId, ...buildPayload() }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create department"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateDepartment(editingId!, buildPayload()),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update department"),
  });

  function openCreateDialog() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    name.onChange("");
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(department: DepartmentRead) {
    setEditingId(department.id);
    setForm({
      campusId: department.campus_id,
      code: department.code ?? "",
      category: department.category ?? "",
      parentGroup: department.parent_group ?? "",
      description: department.description ?? "",
      isActive: department.is_active,
    });
    name.onChange(department.name);
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!name.validate()) return;
    if (!editingId && !form.campusId) {
      setError("Pick a campus.");
      return;
    }
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!user || user.role === "CANDIDATE") {
    return <p className="text-sm text-muted-foreground">Only staff can view Departments.</p>;
  }

  const columnCount = COLUMNS.length + (canManage ? 1 : 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Departments"
        description="The department master -- campus, code, category, and parent group, per department."
        actions={
          <>
            {/* Reordered per the Departments follow-up spec: New Department
                (primary/most prominent) first, then Bulk upload + its
                Upload history trigger adjacent, then Export last. */}
            {canManage ? (
              <>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog}>+ New Department</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingId ? "Edit department" : "New department"}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <Label>Campus</Label>
                        {editingId ? (
                          <p className="text-sm font-mono text-muted-foreground">
                            {campusById.get(form.campusId)?.code ?? "—"}
                          </p>
                        ) : (
                          <Select value={form.campusId} onValueChange={(v) => setForm((f) => ({ ...f, campusId: v }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a campus" />
                            </SelectTrigger>
                            <SelectContent>
                              {(campuses ?? []).filter((campus) => campus.is_active).map((campus) => (
                                <SelectItem key={campus.id} value={campus.id}>
                                  {campus.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {editingId ? (
                          <p className="text-xs text-muted-foreground">Campus can't be changed after creation.</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="department_name">Name</Label>
                        <Input
                          id="department_name"
                          required
                          value={name.value}
                          onChange={(e) => name.onChange(e.target.value)}
                          onBlur={name.onBlur}
                          aria-invalid={Boolean(name.error)}
                        />
                        {name.error ? <p className="text-xs text-destructive">{name.error}</p> : null}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="department_code">Code (optional)</Label>
                          <Input
                            id="department_code"
                            value={form.code}
                            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Teaching / Non-Teaching (optional)</Label>
                          <Select
                            value={form.category || "NONE"}
                            onValueChange={(v) =>
                              setForm((f) => ({ ...f, category: v === "NONE" ? "" : (v as StaffRoleCategory) }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Not set" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">Not set</SelectItem>
                              {CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>
                                  {category.replace(/_/g, " ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="department_parent_group">Parent group (optional)</Label>
                        <Input
                          id="department_parent_group"
                          placeholder="e.g. School of Engineering"
                          value={form.parentGroup}
                          onChange={(e) => setForm((f) => ({ ...f, parentGroup: e.target.value }))}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="department_description">Description (optional)</Label>
                        <Textarea
                          id="department_description"
                          placeholder="Free-text notes about this department"
                          value={form.description}
                          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label>Active</Label>
                        <Select
                          value={form.isActive ? "true" : "false"}
                          onValueChange={(v) => setForm((f) => ({ ...f, isActive: v === "true" }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Active</SelectItem>
                            <SelectItem value="false">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                    <DialogFooter>
                      <Button disabled={isSaving} onClick={submit}>
                        {isSaving ? "Saving…" : editingId ? "Save changes" : "Create department"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <DepartmentBulkUploadDialog />
                <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Upload history
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Department bulk upload history</DialogTitle>
                    </DialogHeader>
                    <UploadHistoryTab entityType="DEPARTMENT" />
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
            {/* Export is gated `_staff_only` server-side (broader than
                DEPARTMENT_MANAGEMENT_ROLES/canManage) -- mirrored here as an
                always-visible action for any staff role that can view this
                page at all, not narrowed to canManage. Deliberately last in
                visual order -- least prominent of the header actions. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      />

      <CategoryTabs
        value={categoryTab}
        onValueChange={(v) => {
          setCategoryTab(v);
          setOffset(0);
        }}
        counts={mapServerCategoryCounts(data?.category_counts)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSearch();
          }}
          placeholder="Search by name or code"
          aria-label="Search departments"
          className="sm:max-w-xs"
        />
        <Select
          value={campusFilter}
          onValueChange={(v) => {
            setCampusFilter(v);
            setOffset(0);
          }}
        >
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
        <Select
          value={parentGroupFilter}
          onValueChange={(v) => {
            setParentGroupFilter(v);
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Parent group filter" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All parent groups</SelectItem>
            {(parentGroups ?? []).map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={activeFilter}
          onValueChange={(v) => {
            setActiveFilter(v as "ALL" | "true" | "false");
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Active filter" className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {filtersActive ? <span className="text-xs text-muted-foreground">Filters applied</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!filtersActive}
            onClick={clearFilters}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {/* Deliberately NOT the `Table` wrapper component here -- its own
              `overflow-x-auto` div breaks `position: sticky` headers (see
              SanctionedStrengthPage.tsx's own comment on this exact
              root-cause finding, commit ce3dad6 and after). Card/CardContent
              set no overflow of their own, so the sticky header stays pinned
              to AppShell's `<main>` scroll container instead. */}
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead
                    key={column.key}
                    sorted={sortBy === column.sortBy ? sortDir : false}
                    onSort={() => handleSort(column)}
                  >
                    {column.label}
                  </TableHead>
                ))}
                {canManage ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={columnCount} loading />
              ) : isError ? (
                <TableEmpty colSpan={columnCount} className="text-destructive">
                  {loadError instanceof ApiError ? loadError.message : "Failed to load departments."}
                </TableEmpty>
              ) : departments.length === 0 ? (
                <TableEmpty colSpan={columnCount}>
                  <div className="flex flex-col items-center gap-2 py-2">
                    <p>{filtersActive ? "No departments match the current filters." : "No departments found."}</p>
                    {filtersActive ? (
                      <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : canManage ? (
                      <Button type="button" size="sm" onClick={openCreateDialog}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        + New Department
                      </Button>
                    ) : null}
                  </div>
                </TableEmpty>
              ) : (
                departments.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-mono text-xs">
                      {campusById.get(department.campus_id)?.code ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{department.name}</TableCell>
                    <TableCell>{department.code ?? "—"}</TableCell>
                    <TableCell>
                      {department.category ? <CategoryBadge category={department.category} /> : "—"}
                    </TableCell>
                    <TableCell>{department.parent_group ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={department.is_active ? "success" : "destructive"}>
                        {department.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <DepartmentRowActions
                          department={department}
                          onEdit={() => openEditDialog(department)}
                          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["departments"] })}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </CardContent>
      </Card>

      <Pagination
        total={total}
        limit={limit}
        offset={offset}
        onOffsetChange={setOffset}
        onLimitChange={(nextLimit) => {
          setLimit(nextLimit);
          setOffset(0);
        }}
        itemLabel="departments"
      />
    </div>
  );
}
