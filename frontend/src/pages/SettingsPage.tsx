import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { createCampus, listCampuses, updateCampus } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { createDepartment, listDepartments, updateDepartment } from "@/api/departments";
import {
  CAMPUS_CODES,
  DEPARTMENT_MANAGEMENT_ROLES,
  type CampusCode,
  type CampusRead,
  type DepartmentRead,
  type StaffRoleCategory,
} from "@/api/types";
import { getOwnProfile, updateOwnProfile } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { minLength, required, useFieldValidation } from "@/hooks/useFieldValidation";
import { useTheme } from "@/theme/ThemeContext";

function CampusManagementCard() {
  const queryClient = useQueryClient();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<CampusCode | "">("");
  const name = useFieldValidation("", required("Name is required"));
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const usedCodes = new Set((campuses ?? []).map((c) => c.code));
  const availableCodes = CAMPUS_CODES.filter((code) => !usedCodes.has(code));

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["campuses"] });
  }

  const createMutation = useMutation({
    mutationFn: () => createCampus({ code: newCode as CampusCode, name: name.value, is_active: isActive }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create campus"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateCampus(editingId!, { name: name.value, is_active: isActive }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update campus"),
  });

  function openCreateDialog() {
    setEditingId(null);
    setNewCode(availableCodes[0] ?? "");
    name.onChange("");
    setIsActive(true);
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(campus: CampusRead) {
    setEditingId(campus.id);
    setNewCode(campus.code);
    name.onChange(campus.name);
    setIsActive(campus.is_active);
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!name.validate()) return;
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Campuses</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={availableCodes.length === 0} onClick={openCreateDialog}>
              New campus
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit campus" : "New campus"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Institutional code</Label>
                {editingId ? (
                  <p className="text-sm font-mono text-muted-foreground">{newCode}</p>
                ) : (
                  <Select value={newCode} onValueChange={(v) => setNewCode(v as CampusCode)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a code" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCodes.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="campus_name">Name</Label>
                <Input
                  id="campus_name"
                  value={name.value}
                  onChange={(e) => name.onChange(e.target.value)}
                  onBlur={name.onBlur}
                  aria-invalid={Boolean(name.error)}
                />
                {name.error ? <p className="text-xs text-destructive">{name.error}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Active</Label>
                <Select value={isActive ? "true" : "false"} onValueChange={(v) => setIsActive(v === "true")}>
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
              <Button disabled={!newCode || !name.value.trim() || isSaving} onClick={submit}>
                {isSaving ? "Saving…" : editingId ? "Save changes" : "Create campus"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!campuses || campuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campuses found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Code</th>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Active</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campuses.map((campus) => (
                <tr key={campus.id} className="border-b border-border last:border-0">
                  <td className="py-2 font-mono text-xs">{campus.code}</td>
                  <td className="py-2">{campus.name}</td>
                  <td className="py-2">
                    <Badge variant={campus.is_active ? "success" : "destructive"}>
                      {campus.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(campus)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

const DEPARTMENT_CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

function DepartmentManagementCard() {
  const queryClient = useQueryClient();
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [campusId, setCampusId] = useState("");
  const name = useFieldValidation("", required("Name is required"));
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<StaffRoleCategory | "">("");
  const [parentGroup, setParentGroup] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  function buildPayload() {
    return {
      name: name.value,
      code: code.trim() || null,
      category: category || null,
      parent_group: parentGroup.trim() || null,
      is_active: isActive,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => createDepartment({ campus_id: campusId, ...buildPayload() }),
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
    setCampusId("");
    name.onChange("");
    setCode("");
    setCategory("");
    setParentGroup("");
    setIsActive(true);
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(department: DepartmentRead) {
    setEditingId(department.id);
    setCampusId(department.campus_id);
    name.onChange(department.name);
    setCode(department.code ?? "");
    setCategory(department.category ?? "");
    setParentGroup(department.parent_group ?? "");
    setIsActive(department.is_active);
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!name.validate() || !campusId) return;
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Departments</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreateDialog}>
              New department
            </Button>
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
                    {campuses?.find((c) => c.id === campusId)?.code ?? "—"}
                  </p>
                ) : (
                  <Select value={campusId} onValueChange={setCampusId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a campus" />
                    </SelectTrigger>
                    <SelectContent>
                      {campuses?.map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campus.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="department_name">Name</Label>
                <Input
                  id="department_name"
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
                  <Input id="department_code" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Teaching / Non-Teaching (optional)</Label>
                  <Select
                    value={category || "NONE"}
                    onValueChange={(v) => setCategory(v === "NONE" ? "" : (v as StaffRoleCategory))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Not set</SelectItem>
                      {DEPARTMENT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace(/_/g, " ")}
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
                  value={parentGroup}
                  onChange={(e) => setParentGroup(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Active</Label>
                <Select value={isActive ? "true" : "false"} onValueChange={(v) => setIsActive(v === "true")}>
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
              <Button disabled={!campusId || !name.value.trim() || isSaving} onClick={submit}>
                {isSaving ? "Saving…" : editingId ? "Save changes" : "Create department"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!departments || departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Campus</th>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Code</th>
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium">Parent group</th>
                <th className="py-2 font-medium">Active</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => {
                const campus = campuses?.find((c) => c.id === department.campus_id);
                return (
                  <tr key={department.id} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                    <td className="py-2">{department.name}</td>
                    <td className="py-2">{department.code ?? "—"}</td>
                    <td className="py-2">{department.category ? department.category.replace(/_/g, " ") : "—"}</td>
                    <td className="py-2">{department.parent_group ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant={department.is_active ? "success" : "destructive"}>
                        {department.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(department)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();

  const { data: profile, isLoading } = useQuery({ queryKey: ["users", "me"], queryFn: getOwnProfile });

  const fullName = useFieldValidation("", required("Full name is required"));
  const [phoneNumber, setPhoneNumber] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    fullName.onChange(profile.full_name);
    setPhoneNumber(profile.phone_number ?? "");
    // Only sync from the server once profile data first arrives -- don't
    // clobber in-progress edits on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const passwordValid = !newPassword || newPassword.length >= 8;

  const mutation = useMutation({
    mutationFn: () =>
      updateOwnProfile({
        full_name: fullName.value,
        phone_number: phoneNumber || null,
        ...(newPassword ? { password: newPassword } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setSuccess(true);
      setNewPassword("");
      void queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
    onError: (err) => {
      setSuccess(false);
      setError(err instanceof ApiError ? err.message : "Update failed");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(false);
    if (!fullName.validate() || !passwordValid) return;
    mutation.mutate();
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const canManageCampuses = user?.role === "SUPER_ADMIN";
  const canManageDepartments = Boolean(user && DEPARTMENT_MANAGEMENT_ROLES.includes(user.role));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">{profile?.email}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                required
                value={fullName.value}
                onChange={(e) => fullName.onChange(e.target.value)}
                onBlur={fullName.onBlur}
                aria-invalid={Boolean(fullName.error)}
              />
              {fullName.error ? <p className="text-xs text-destructive">{fullName.error}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone_number">Phone number</Label>
              <Input id="phone_number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_password">New password (leave blank to keep current)</Label>
              <Input
                id="new_password"
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={!passwordValid}
              />
              {!passwordValid ? (
                <p className="text-xs text-destructive">{minLength(8)(newPassword)}</p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? <p className="text-sm text-brand-success">Saved.</p> : null}

            <Button type="submit" className="w-fit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm">
            <div className="font-medium">Theme</div>
            <div className="text-muted-foreground">Currently {theme === "dark" ? "dark" : "light"} mode</div>
          </div>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            Switch to {theme === "dark" ? "light" : "dark"}
          </Button>
        </CardContent>
      </Card>

      {canManageCampuses || canManageDepartments ? (
        <>
          <h2 className="text-base font-semibold">Organization</h2>
          {canManageCampuses ? <CampusManagementCard /> : null}
          {canManageDepartments ? <DepartmentManagementCard /> : null}
        </>
      ) : null}
    </div>
  );
}
