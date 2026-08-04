import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createDesignation, listDesignations, updateDesignation } from "@/api/designations";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { DESIGNATION_WRITE_ROLES, type DesignationRead, type EmploymentType, type StaffRoleCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT"];

interface FormState {
  category: StaffRoleCategory;
  employmentType: EmploymentType;
  isActive: boolean;
  departmentIds: string[];
}

const EMPTY_FORM: FormState = {
  category: "TEACHING",
  employmentType: "FULL_TIME",
  isActive: true,
  departmentIds: [],
};

export function DesignationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Designation name is required"));
  const qualification = useFieldValidation("", required("Qualification is required"));
  const minExperience = useFieldValidation("", required("Minimum experience is required"));
  const [error, setError] = useState<string | null>(null);

  const { data: designations, isLoading } = useQuery({ queryKey: ["designations"], queryFn: () => listDesignations() });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const canManage = Boolean(user && DESIGNATION_WRITE_ROLES.includes(user.role));

  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));

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

  function submit() {
    const nameValid = name.validate();
    const qualificationValid = qualification.validate();
    const minExperienceValid = minExperience.validate();
    if (!nameValid || !qualificationValid || !minExperienceValid) return;
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
          canManage ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreateDialog}>New designation</Button>
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
                        onValueChange={(v) => setForm((f) => ({ ...f, category: v as StaffRoleCategory }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category.replace(/_/g, " ")}
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-start font-normal">
                          {form.departmentIds.length === 0
                            ? "Select departments"
                            : `${form.departmentIds.length} department${form.departmentIds.length === 1 ? "" : "s"} selected`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="max-h-64 w-72 overflow-y-auto">
                        {(departments ?? []).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No departments found.</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {(departments ?? []).map((department) => (
                              <li key={department.id}>
                                <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-input"
                                    checked={form.departmentIds.includes(department.id)}
                                    onChange={() => toggleDepartment(department.id)}
                                  />
                                  {department.name}
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </PopoverContent>
                    </Popover>
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
          ) : undefined
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !designations || designations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No designations found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Category</th>
              <th className="py-2 font-medium">Departments</th>
              <th className="py-2 font-medium">Qualification</th>
              <th className="py-2 font-medium">Min. experience</th>
              <th className="py-2 font-medium">Employment type</th>
              <th className="py-2 font-medium">Active</th>
              {canManage ? <th className="py-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {designations.map((designation) => (
              <tr key={designation.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="py-2 font-medium text-foreground">{designation.name}</td>
                <td className="py-2">{designation.category.replace(/_/g, " ")}</td>
                <td className="py-2">
                  {designation.department_ids.length === 0
                    ? "—"
                    : designation.department_ids.map((id) => departmentNameById.get(id) ?? "Unknown").join(", ")}
                </td>
                <td className="py-2">{designation.qualification}</td>
                <td className="py-2">{designation.min_experience}</td>
                <td className="py-2">{designation.employment_type.replace(/_/g, " ")}</td>
                <td className="py-2">
                  <Badge variant={designation.is_active ? "success" : "destructive"}>
                    {designation.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="py-2">
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(designation)}>
                      Edit
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
