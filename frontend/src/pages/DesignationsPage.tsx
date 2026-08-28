import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createDesignation,
  deleteDesignation,
  exportDesignations,
  listDesignationsWithCounts,
  updateDesignation,
} from "@/api/designations";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import {
  DESIGNATION_WRITE_ROLES,
  type DepartmentRead,
  type DesignationRead,
  type EmploymentType,
  type StaffRoleCategory,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryBadge } from "@/components/domain/CategoryBadge";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";
import { DesignationBulkUploadDialog } from "@/components/designations/DesignationBulkUploadDialog";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CategoryTabs, mapServerCategoryCounts } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT", "TRA", "JRF"];
// Same labels as CategoryTabs/DashboardPage's ROLE_CATEGORY_LABELS -- this
// page previously fell back to a raw `.replace(/_/g, " ")` (rendering
// "NON TEACHING", all-caps) instead of the "Non-Teaching" convention every
// other category-aware page already uses.
const CATEGORY_LABELS: Record<StaffRoleCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
};

interface FormState {
  category: StaffRoleCategory;
  employmentType: EmploymentType;
  // Designation Master production-hardening epic (backend Phase 1) --
  // nullable free-text field on the backend; kept as a plain string here
  // (empty string = unset) and trimmed to `null` on submit, same convention
  // as DepartmentsPage's own `description` field.
  requiredSkills: string;
  isActive: boolean;
  departmentIds: string[];
}

// The Departments table cell is now purely view-only: a static "N
// Department(s)" count line plus a separate "View Departments" link-button
// that opens a read-only Dialog listing every mapped department name (with
// client-side search). All editing now happens exclusively through the
// Edit designation dialog's own "Applicable departments" picker below --
// this cell never calls updateDesignation, for anyone, canManage or not.
function DesignationDepartmentsCell({
  designation,
  departmentNameById,
}: {
  designation: DesignationRead;
  departmentNameById: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const count = designation.department_ids.length;

  // Nothing to view when there are no linked departments -- same plain "—"
  // the read-only cell always showed before this dialog existed.
  if (count === 0) {
    return <>—</>;
  }

  const departmentNames = designation.department_ids
    .map((id) => ({ id, name: departmentNameById.get(id) ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const trimmedSearch = search.trim();
  const filteredNames = trimmedSearch
    ? departmentNames.filter((d) => d.name.toLowerCase().includes(trimmedSearch.toLowerCase()))
    : departmentNames;

  return (
    <div className="flex flex-col gap-0.5">
      <span>
        {count} Department{count === 1 ? "" : "s"}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <DialogTrigger asChild>
          <button type="button" className="w-fit text-left text-xs text-primary underline-offset-2 hover:underline">
            View Departments
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{designation.name}</DialogTitle>
            <p className="text-sm text-muted-foreground">{CATEGORY_LABELS[designation.category]}</p>
            {/* Designation Master production-hardening epic (backend Phase
                1) -- required_skills surfaced here too, since this dialog is
                this page's closest analog to a per-designation detail view
                (it already shows name + category; there's no separate
                DesignationDetailPage). Nullable, so only rendered when set. */}
            {designation.required_skills ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Required skills:</span> {designation.required_skills}
              </p>
            ) : null}
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Departments ({count})</p>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search departments"
              aria-label="Search departments"
            />
            <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2">
              {filteredNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">No departments match &quot;{trimmedSearch}&quot;.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {filteredNames.map((department) => (
                    <li key={department.id} className="rounded-md px-2 py-1.5">
                      {department.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Searchable multi-select popover for the Edit/New designation dialog's
// "Applicable departments" field, built on the existing Popover primitives.
// `categoryDepartments` is already filtered by the caller to
// `department.category === form.category` -- this component never sees (and
// so can never offer) a cross-category department.
function DepartmentMultiSelect({
  categoryDepartments,
  selectedIds,
  onToggle,
  onReplaceSelection,
}: {
  categoryDepartments: DepartmentRead[];
  selectedIds: string[];
  onToggle: (departmentId: string) => void;
  onReplaceSelection: (departmentIds: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const trimmedSearch = normalizeSearch(search);
  const filtered = trimmedSearch
    ? categoryDepartments.filter((d) => d.name.toLowerCase().includes(trimmedSearch))
    : categoryDepartments;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal">
          {selectedIds.length === 0
            ? "Select departments"
            : `${selectedIds.length} department${selectedIds.length === 1 ? "" : "s"} selected`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments"
            aria-label="Search departments"
          />
          <div className="flex items-center justify-between text-xs">
            {/* Select all / Clear all deliberately act on the full
                category-filtered list, not whatever's currently visible
                under an active search term -- so "Select all" after typing
                "bio" still selects every department in this category, not
                just the one visible match. That keeps the button's meaning
                unambiguous regardless of the search box's contents. */}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
              disabled={categoryDepartments.length === 0}
              onClick={() => onReplaceSelection(categoryDepartments.map((d) => d.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
              disabled={selectedIds.length === 0}
              onClick={() => onReplaceSelection([])}
            >
              Clear all
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {categoryDepartments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No departments found for this category.</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No departments match &quot;{search.trim()}&quot;.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((department) => (
                  <li key={department.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedIds.includes(department.id)}
                        onChange={() => onToggle(department.id)}
                      />
                      {department.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Row-actions cell (Edit + mutually-exclusive Delete/Restore) -- same
// underlying behavior as DepartmentsPage.tsx's own `DepartmentRowActions`
// (Restore reuses the existing PATCH endpoint via `updateDesignation(id,
// { is_active: true })`, no new backend route needed; an already-inactive
// row only offers Restore, an active row only offers Delete), kept as
// simple inline buttons rather than a 3-dot Popover menu -- this page's
// pre-existing Actions cell was already a flat Edit/Delete button pair, not
// a Popover, so this stays consistent with that rather than introducing a
// new UI shape unprompted.
function DesignationRowActions({
  designation,
  onEdit,
  onChanged,
}: {
  designation: DesignationRead;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();

  const restoreMutation = useMutation({
    mutationFn: () => updateDesignation(designation.id, { is_active: true }),
    onSuccess: () => {
      toast.success(`${designation.name} restored.`);
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to restore designation"),
  });

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button variant="outline" size="sm" onClick={onEdit}>
        Edit
      </Button>
      {designation.is_active ? (
        <DeleteConfirmDialog
          triggerAriaLabel={`Delete designation ${designation.name}`}
          title="Delete designation"
          description={
            <>
              Remove <span className="font-medium text-foreground">{designation.name}</span>? This is a soft
              delete -- the designation stays visible (as Inactive) and can be reactivated later.
            </>
          }
          onDelete={() => deleteDesignation(designation.id)}
          onDeleted={onChanged}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Restore designation ${designation.name}`}
          disabled={restoreMutation.isPending}
          onClick={() => restoreMutation.mutate()}
        >
          {restoreMutation.isPending ? "Restoring…" : "Restore"}
        </Button>
      )}
    </div>
  );
}

const EMPTY_FORM: FormState = {
  category: "TEACHING",
  employmentType: "FULL_TIME",
  requiredSkills: "",
  isActive: true,
  departmentIds: [],
};

const BASE_COLUMN_COUNT = 7;

export function DesignationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Designation name is required"));
  const qualification = useFieldValidation("", required("Qualification is required"));
  const minExperience = useFieldValidation("", required("Minimum experience is required"));
  const [error, setError] = useState<string | null>(null);

  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryFilter, setCategoryFilter] = useCategoryTabState();
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("ALL");
  // Department filter -- backend addition alongside the new `search` param
  // (GET /designations already accepted `department_id`; this just exposes
  // it as a page-level filter rather than only the create/edit picker).
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");
  // searchInput tracks every keystroke; search (the value actually sent to
  // the server) only updates on blur/Enter -- search moved server-side this
  // epic (was 100% client-side substring filtering before), same
  // commit-on-blur convention as DepartmentsPage's own search box.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["designations", categoryFilter, activeFilter, search, departmentFilter],
    queryFn: () =>
      listDesignationsWithCounts({
        category: categoryFilter === "ALL" ? undefined : categoryFilter,
        isActive: activeFilter === "ALL" ? undefined : activeFilter === "true",
        search: search.trim() || undefined,
        departmentId: departmentFilter === "ALL" ? undefined : departmentFilter,
      }),
  });
  const designations = data?.items ?? [];
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const canManage = Boolean(user && DESIGNATION_WRITE_ROLES.includes(user.role));

  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const filtersActive =
    categoryFilter !== "ALL" || activeFilter !== "ALL" || search.trim() !== "" || departmentFilter !== "ALL";

  function commitSearch() {
    setSearch(searchInput);
  }

  const exportMutation = useMutation({
    mutationFn: () =>
      exportDesignations({
        category: categoryFilter === "ALL" ? undefined : categoryFilter,
        isActive: activeFilter === "ALL" ? undefined : activeFilter === "true",
        search: search.trim() || undefined,
        departmentId: departmentFilter === "ALL" ? undefined : departmentFilter,
      }),
  });

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    setEditingId(null);
    void queryClient.invalidateQueries({ queryKey: ["designations"] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createDesignation({
        name: name.value,
        category: form.category,
        qualification: qualification.value,
        min_experience: minExperience.value,
        employment_type: form.employmentType,
        required_skills: form.requiredSkills.trim() || null,
        is_active: form.isActive,
        department_ids: form.departmentIds,
      }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create designation"),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateDesignation(editingId!, {
        name: name.value,
        category: form.category,
        qualification: qualification.value,
        min_experience: minExperience.value,
        employment_type: form.employmentType,
        required_skills: form.requiredSkills.trim() || null,
        is_active: form.isActive,
        department_ids: form.departmentIds,
      }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update designation"),
  });

  function openCreateDialog() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    name.onChange("");
    qualification.onChange("");
    minExperience.onChange("");
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(designation: DesignationRead) {
    setEditingId(designation.id);
    setForm({
      category: designation.category,
      employmentType: designation.employment_type,
      requiredSkills: designation.required_skills ?? "",
      isActive: designation.is_active,
      departmentIds: designation.department_ids,
    });
    name.onChange(designation.name);
    qualification.onChange(designation.qualification);
    minExperience.onChange(designation.min_experience);
    setError(null);
    setDialogOpen(true);
  }

  function toggleDepartment(departmentId: string) {
    setForm((f) => ({
      ...f,
      departmentIds: f.departmentIds.includes(departmentId)
        ? f.departmentIds.filter((id) => id !== departmentId)
        : [...f.departmentIds, departmentId],
    }));
  }

  function departmentIdsForCategory(category: StaffRoleCategory): Set<string> {
    // Membership, not equality: CSE supports TEACHING and NON_TEACHING,
    // so it is a valid target for designations of either.
    return new Set(
      (departments ?? []).filter((d) => d.supported_categories.includes(category)).map((d) => d.id),
    );
  }

  function submit() {
    const nameValid = name.validate();
    const qualificationValid = qualification.validate();
    const minExperienceValid = minExperience.validate();
    if (!nameValid || !qualificationValid || !minExperienceValid) return;

    // Defense in depth: the category Select's onValueChange already
    // intersects departmentIds down to the new category whenever it
    // changes, and DepartmentMultiSelect only ever offers category-matching
    // checkboxes, so this should be structurally impossible to trip -- but
    // block submission rather than silently send a mismatched pair to the
    // backend if some path we haven't thought of leaves a stale id behind.
    const validDepartmentIds = departmentIdsForCategory(form.category);
    if (form.departmentIds.some((id) => !validDepartmentIds.has(id))) {
      setError("One or more selected departments don't match the selected category. Please re-select departments.");
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
    return <p className="text-sm text-muted-foreground">Only staff can view the Designation Master.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Designation Master"
        description="The catalog of hireable designations -- qualification, experience, and employment type per designation, linked to the departments it applies to."
        actions={
          <>
            {/* Header actions ordered per the Departments follow-up spec
                this epic mirrors: + New Designation (primary/most
                prominent) first, then Bulk upload + its Upload history
                trigger adjacent, then Export last. */}
            {canManage ? (
              <>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog}>+ New Designation</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingId ? "Edit designation" : "New designation"}</DialogTitle>
                    </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="designation_name">Designation name</Label>
                    <Input
                      id="designation_name"
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
                      <Label>Teaching / Non-Teaching</Label>
                      <Select
                        value={form.category}
                        onValueChange={(v) => {
                          const nextCategory = v as StaffRoleCategory;
                          // Applicable departments are always filtered to
                          // the current category (see DepartmentMultiSelect
                          // below) -- switching category must immediately
                          // drop any selection that's no longer valid for
                          // it, rather than leaving a stale cross-category
                          // id sitting invisibly in departmentIds.
                          const validIds = departmentIdsForCategory(nextCategory);
                          setForm((f) => ({
                            ...f,
                            category: nextCategory,
                            departmentIds: f.departmentIds.filter((id) => validIds.has(id)),
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {CATEGORY_LABELS[category]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label>Employment type</Label>
                      <Select
                        value={form.employmentType}
                        onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v as EmploymentType }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EMPLOYMENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Applicable departments</Label>
                    <DepartmentMultiSelect
                      categoryDepartments={(departments ?? []).filter((d) =>
                        d.supported_categories.includes(form.category),
                      )}
                      selectedIds={form.departmentIds}
                      onToggle={toggleDepartment}
                      onReplaceSelection={(ids) => setForm((f) => ({ ...f, departmentIds: ids }))}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qualification">Qualification</Label>
                    <Input
                      id="qualification"
                      required
                      value={qualification.value}
                      onChange={(e) => qualification.onChange(e.target.value)}
                      onBlur={qualification.onBlur}
                      aria-invalid={Boolean(qualification.error)}
                    />
                    {qualification.error ? <p className="text-xs text-destructive">{qualification.error}</p> : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="min_experience">Minimum experience</Label>
                    <Input
                      id="min_experience"
                      required
                      placeholder="e.g. 2+ years"
                      value={minExperience.value}
                      onChange={(e) => minExperience.onChange(e.target.value)}
                      onBlur={minExperience.onBlur}
                      aria-invalid={Boolean(minExperience.error)}
                    />
                    {minExperience.error ? <p className="text-xs text-destructive">{minExperience.error}</p> : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="required_skills">Required skills (optional)</Label>
                    <Textarea
                      id="required_skills"
                      placeholder="Free-text notes on the skills this designation requires"
                      value={form.requiredSkills}
                      onChange={(e) => setForm((f) => ({ ...f, requiredSkills: e.target.value }))}
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
                    {isSaving ? "Saving…" : editingId ? "Save changes" : "Create designation"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <DesignationBulkUploadDialog />
            <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Upload history
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Designation bulk upload history</DialogTitle>
                </DialogHeader>
                <UploadHistoryTab entityType="DESIGNATION" />
              </DialogContent>
            </Dialog>
              </>
            ) : null}
            {/* Export is gated `_staff_only` server-side (broader than
                DESIGNATION_WRITE_ROLES/canManage) -- mirrored here as an
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
        value={categoryFilter}
        onValueChange={setCategoryFilter}
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
          placeholder="Search by name"
          aria-label="Search designations"
          className="sm:max-w-xs"
        />
        <Select
          value={departmentFilter}
          onValueChange={(v) => setDepartmentFilter(v)}
        >
          <SelectTrigger aria-label="Department filter" className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All departments</SelectItem>
            {(departments ?? []).map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          <Table className="table-fixed">
            <colgroup>
              {/* Name/Departments/Employment type/Category/Active/Min. experience/Actions all get a
                  fixed rem-based width sized for their real content (see DesignationsPage.test.tsx and
                  the live dev DB check that motivated this) -- deliberately not percentages, so these
                  columns never shrink into overflow-collision territory on a narrower viewport.
                  Qualification is the one column left unsized, so it alone absorbs all remaining
                  table width (per the table-layout: fixed spec) and truncates instead of colliding
                  into "Min. experience" when the text is long. */}
              <col className="w-44" />
              <col className="w-32" />
              <col className="w-32" />
              <col />
              <col className="w-40" />
              <col className="w-32" />
              <col className="w-24" />
              {canManage ? <col className="w-28" /> : null}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Departments</TableHead>
                <TableHead>Qualification</TableHead>
                <TableHead>Min. experience</TableHead>
                <TableHead>Employment type</TableHead>
                <TableHead>Active</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={BASE_COLUMN_COUNT + (canManage ? 1 : 0)} loading />
              ) : designations.length === 0 ? (
                <TableEmpty colSpan={BASE_COLUMN_COUNT + (canManage ? 1 : 0)}>
                  {filtersActive ? "No designations match the current filters." : "No designations found."}
                </TableEmpty>
              ) : (
                designations.map((designation) => (
                  <TableRow key={designation.id}>
                    <TableCell className="truncate font-medium text-foreground" title={designation.name}>
                      {designation.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <CategoryBadge category={designation.category} />
                    </TableCell>
                    <TableCell>
                      <DesignationDepartmentsCell designation={designation} departmentNameById={departmentNameById} />
                    </TableCell>
                    <TableCell className="truncate" title={designation.qualification}>
                      {designation.qualification}
                    </TableCell>
                    <TableCell className="truncate" title={designation.min_experience}>
                      {designation.min_experience}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {designation.employment_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={designation.is_active ? "success" : "destructive"}>
                        {designation.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <DesignationRowActions
                          designation={designation}
                          onEdit={() => openEditDialog(designation)}
                          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["designations"] })}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
