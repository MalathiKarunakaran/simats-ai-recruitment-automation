import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { createDepartment, deleteDepartment, listDepartments, updateDepartment } from "@/api/departments";
import { DEPARTMENT_MANAGEMENT_ROLES, type DepartmentRead, type StaffRoleCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

interface FormState {
  campusId: string;
  code: string;
  category: StaffRoleCategory | "";
  parentGroup: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { campusId: "", code: "", category: "", parentGroup: "", isActive: true };

export function DepartmentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Department name is required"));
  const [error, setError] = useState<string | null>(null);

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryTab, setCategoryTab] = useCategoryTabState();
  // Defaults to Active-only -- inactive/leftover departments shouldn't
  // clutter the list while real data is still being entered; still
  // reachable via this filter, just not shown by default.
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  const [search, setSearch] = useState("");

  const { data: departments, isLoading } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && DEPARTMENT_MANAGEMENT_ROLES.includes(user.role));

  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));

  const filtersActive =
    campusFilter !== "ALL" || categoryTab !== "ALL" || activeFilter !== "true" || search.trim() !== "";
  // Every filter except the category tab -- shared between the visible list
  // and the CategoryTabs counts, so each tab's count reflects "how many in
  // this category, given the *other* active filters" (campus/active/search),
  // not the whole unfiltered list.
  const preCategoryFiltered = (departments ?? [])
    .filter((d) => campusFilter === "ALL" || d.campus_id === campusFilter)
    .filter((d) => activeFilter === "ALL" || (activeFilter === "true" ? d.is_active : !d.is_active))
    .filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()));
  const categoryTabCounts = {
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((d) => d.category === "TEACHING").length,
    nonTeaching: preCategoryFiltered.filter((d) => d.category === "NON_TEACHING").length,
    housekeeping: preCategoryFiltered.filter((d) => d.category === "HOUSEKEEPING").length,
  };
  const visibleDepartments = preCategoryFiltered
    .filter((d) => categoryTab === "ALL" || d.category === categoryTab)
    .sort((a, b) => a.name.localeCompare(b.name));

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Departments"
        description="The department master -- campus, code, category, and parent group, per department."
        actions={
          canManage ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreateDialog}>New department</Button>
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
          ) : undefined
        }
      />

      <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          aria-label="Search departments"
          className="sm:max-w-xs"
        />
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
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : visibleDepartments.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {filtersActive ? "No departments match the current filters." : "No departments found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Campus</th>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Code</th>
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 font-medium">Parent group</th>
                    <th className="py-2 font-medium">Active</th>
                    {canManage ? <th className="py-2 font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleDepartments.map((department) => (
                    <tr key={department.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="py-2 font-mono text-xs">{campusById.get(department.campus_id)?.code ?? "—"}</td>
                      <td className="py-2 font-medium text-foreground">{department.name}</td>
                      <td className="py-2">{department.code ?? "—"}</td>
                      <td className="py-2">{department.category ? department.category.replace(/_/g, " ") : "—"}</td>
                      <td className="py-2">{department.parent_group ?? "—"}</td>
                      <td className="py-2">
                        <Badge variant={department.is_active ? "success" : "destructive"}>
                          {department.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(department)}>
                              Edit
                            </Button>
                            <DeleteConfirmDialog
                              triggerAriaLabel={`Delete department ${department.name}`}
                              title="Delete department"
                              description={
                                <>
                                  Remove <span className="font-medium text-foreground">{department.name}</span>?
                                  This is a soft delete -- the department stays visible (as Inactive) and can be
                                  reactivated later.
                                </>
                              }
                              onDelete={() => deleteDepartment(department.id)}
                              onDeleted={() => void queryClient.invalidateQueries({ queryKey: ["departments"] })}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
