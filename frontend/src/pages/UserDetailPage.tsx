import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import {
  ASSIGNABLE_STAFF_ROLES,
  COORDINATOR_CAPABILITIES,
  COORDINATOR_CAPABILITY_LABELS,
  SINGLE_CAMPUS_SCOPE_ROLES,
  USER_MANAGEMENT_ROLES,
  type CoordinatorCapability,
  type UserRole,
} from "@/api/types";
import { adminResetPassword, getUser, getUserCapabilities, setUserCapabilities, updateUser } from "@/api/users";
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
import { combine, minLength, required, useFieldValidation } from "@/hooks/useFieldValidation";

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: target, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id!),
    enabled: Boolean(id),
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  // GET /users/{id}/capabilities is SUPER_ADMIN-or-self only (narrower than
  // the campus-scoped staff read every other field on this page uses) --
  // only fetch when the viewer is a Super Admin, since an HR Admin viewing
  // this same page would otherwise get a 403 mid-render.
  const canManageCapabilities = currentUser?.role === "SUPER_ADMIN";
  const isCoordinator = target?.role === "RECRUITMENT_COORDINATOR";
  const { data: capabilitiesData } = useQuery({
    queryKey: ["user-capabilities", id],
    queryFn: () => getUserCapabilities(id!),
    enabled: Boolean(id) && canManageCapabilities && isCoordinator,
  });

  const [role, setRole] = useState<UserRole>("RECRUITMENT_OFFICER");
  const [campusId, setCampusId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<CoordinatorCapability[]>([]);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);

  // SUPER_ADMIN-only (deliberately narrower than USER_MANAGEMENT_ROLES, which
  // also grants HR_ADMIN role/campus edits above) -- mirrors
  // app/api/v1/routers/users.py::admin_reset_password's own require_roles gate.
  const canResetPassword = currentUser?.role === "SUPER_ADMIN";
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  // Bumped on every submit to remount ResetPasswordForm below with fresh,
  // untouched useFieldValidation state -- clears the fields (and any
  // now-stale "required"/"min length" error) immediately, regardless of
  // whether the call itself then succeeds or fails.
  const [resetPasswordFormKey, setResetPasswordFormKey] = useState(0);

  useEffect(() => {
    if (!target) return;
    setRole(target.role);
    setCampusId(target.campus_id ?? "");
    setDepartmentId(target.department_id ?? "");
  }, [target]);

  useEffect(() => {
    if (!capabilitiesData) return;
    setSelectedCapabilities(capabilitiesData.capabilities);
  }, [capabilitiesData]);

  function toggleCapability(capability: CoordinatorCapability) {
    setSelectedCapabilities((prev) =>
      prev.includes(capability) ? prev.filter((c) => c !== capability) : [...prev, capability],
    );
  }

  const departmentOptions = (departments ?? []).filter((d) => d.campus_id === campusId);
  const requiresCampus = SINGLE_CAMPUS_SCOPE_ROLES.includes(role);

  function afterChange() {
    void queryClient.invalidateQueries({ queryKey: ["user", id] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => updateUser(id!, { role, campus_id: campusId || null, department_id: departmentId || null }),
    onSuccess: () => {
      setError(null);
      afterChange();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () => updateUser(id!, { is_active: !target!.is_active }),
    onSuccess: () => {
      setError(null);
      setDeactivateDialogOpen(false);
      afterChange();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const saveCapabilitiesMutation = useMutation({
    mutationFn: () => setUserCapabilities(id!, selectedCapabilities),
    onSuccess: () => {
      setCapabilitiesError(null);
      void queryClient.invalidateQueries({ queryKey: ["user-capabilities", id] });
    },
    onError: (err) => setCapabilitiesError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (password: string) => adminResetPassword(id!, password),
    onSuccess: () => {
      setResetPasswordError(null);
      setResetPasswordSuccess(true);
      afterChange();
    },
    onError: (err) => {
      setResetPasswordSuccess(false);
      setResetPasswordError(err instanceof ApiError ? err.message : "Password reset failed");
    },
  });

  function handleResetPasswordDialogChange(open: boolean) {
    setResetPasswordDialogOpen(open);
    if (!open) {
      setResetPasswordError(null);
      setResetPasswordSuccess(false);
      setResetPasswordFormKey((k) => k + 1);
    }
  }

  function handleResetPasswordSubmit(password: string) {
    setResetPasswordError(null);
    setResetPasswordSuccess(false);
    resetPasswordMutation.mutate(password);
    // Clear immediately on submit, regardless of the call's outcome -- never
    // leave a just-set password sitting in the form.
    setResetPasswordFormKey((k) => k + 1);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!target || !currentUser || !USER_MANAGEMENT_ROLES.includes(currentUser.role)) {
    return <Navigate to="/users" replace />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{target.full_name}</h1>
          <div className="mt-1">
            <Badge variant={target.is_active ? "success" : "destructive"}>
              {target.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/users">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{target.email}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div>{target.phone_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last login</div>
            <div>{target.last_login_at ? new Date(target.last_login_at).toLocaleString() : "Never"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Role</span>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Campus {requiresCampus ? "" : "(optional)"}</span>
              <Select
                value={campusId}
                onValueChange={(value) => {
                  setCampusId(value);
                  setDepartmentId("");
                }}
              >
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
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Department (optional)</span>
              <Select value={departmentId} onValueChange={setDepartmentId} disabled={!campusId}>
                <SelectTrigger>
                  <SelectValue placeholder={campusId ? "Select a department" : "Select a campus first"} />
                </SelectTrigger>
                <SelectContent>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saveMutation.isPending || (requiresCampus && !campusId)}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
            {target.is_active ? (
              <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={target.deactivation_protected}>
                    Deactivate
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deactivate user</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    Deactivate <span className="font-medium text-foreground">{target.full_name}</span>? They will
                    lose access until reactivated.
                  </p>
                  <DialogFooter>
                    <Button
                      variant="destructive"
                      disabled={toggleActiveMutation.isPending}
                      onClick={() => toggleActiveMutation.mutate()}
                    >
                      {toggleActiveMutation.isPending ? "Deactivating…" : "Confirm deactivate"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <Button
                variant="outline"
                disabled={toggleActiveMutation.isPending}
                onClick={() => toggleActiveMutation.mutate()}
              >
                {toggleActiveMutation.isPending ? "Updating…" : "Reactivate"}
              </Button>
            )}
            {canResetPassword ? (
              <Dialog open={resetPasswordDialogOpen} onOpenChange={handleResetPasswordDialogChange}>
                <DialogTrigger asChild>
                  <Button variant="outline">Reset password</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reset password</DialogTitle>
                  </DialogHeader>
                  {resetPasswordSuccess ? (
                    <p className="text-sm text-muted-foreground">
                      Password reset. This user must set a new password on next login.
                    </p>
                  ) : (
                    <ResetPasswordForm
                      key={resetPasswordFormKey}
                      onSubmit={handleResetPasswordSubmit}
                      isPending={resetPasswordMutation.isPending}
                    />
                  )}
                  {resetPasswordError ? <p className="text-sm text-destructive">{resetPasswordError}</p> : null}
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
          {target.is_active && target.deactivation_protected ? (
            <p className="text-xs text-muted-foreground">This account is protected from deactivation.</p>
          ) : null}
        </CardContent>
      </Card>

      {canManageCapabilities && isCoordinator ? (
        <Card>
          <CardHeader>
            <CardTitle>Coordinator capabilities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              A Recruitment Coordinator only gets write access to these action groups if granted here — unlike
              every other role, coordinator access isn't automatic. Toggle the groups this coordinator needs, then
              save.
            </p>
            <div className="flex flex-col gap-2">
              {COORDINATOR_CAPABILITIES.map((capability) => (
                <Button
                  key={capability}
                  type="button"
                  variant={selectedCapabilities.includes(capability) ? "default" : "outline"}
                  className="justify-start text-left font-normal"
                  onClick={() => toggleCapability(capability)}
                >
                  {COORDINATOR_CAPABILITY_LABELS[capability]}
                </Button>
              ))}
            </div>

            {capabilitiesError ? <p className="text-sm text-destructive">{capabilitiesError}</p> : null}
            {saveCapabilitiesMutation.isSuccess ? (
              <p className="text-sm text-muted-foreground">Capabilities saved.</p>
            ) : null}

            <div>
              <Button
                disabled={saveCapabilitiesMutation.isPending}
                onClick={() => saveCapabilitiesMutation.mutate()}
              >
                {saveCapabilitiesMutation.isPending ? "Saving…" : "Save capabilities"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// Owns its own useFieldValidation state so the parent can wipe it (fields +
// touched state, avoiding a stale "required"/"min length" error reappearing
// on an intentionally-cleared field) just by remounting via a bumped `key`,
// instead of the hook needing an explicit reset method.
function ResetPasswordForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (password: string) => void;
  isPending: boolean;
}) {
  const newPassword = useFieldValidation(
    "",
    combine(required("Password is required"), minLength(8, "Must be at least 8 characters")),
  );
  const confirmPassword = useFieldValidation("", required("Please confirm the new password"));
  const [mismatchError, setMismatchError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const passwordValid = newPassword.validate();
    const confirmValid = confirmPassword.validate();
    if (!passwordValid || !confirmValid) return;

    if (newPassword.value !== confirmPassword.value) {
      setMismatchError("Passwords do not match");
      return;
    }
    setMismatchError(null);
    onSubmit(newPassword.value);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset_new_password">New password</Label>
        <Input
          id="reset_new_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword.value}
          onChange={(e) => newPassword.onChange(e.target.value)}
          onBlur={newPassword.onBlur}
          aria-invalid={Boolean(newPassword.error)}
        />
        {newPassword.error ? <p className="text-xs text-destructive">{newPassword.error}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset_confirm_password">Confirm password</Label>
        <Input
          id="reset_confirm_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword.value}
          onChange={(e) => confirmPassword.onChange(e.target.value)}
          onBlur={confirmPassword.onBlur}
          aria-invalid={Boolean(confirmPassword.error)}
        />
        {confirmPassword.error ? <p className="text-xs text-destructive">{confirmPassword.error}</p> : null}
      </div>
      {mismatchError ? <p className="text-sm text-destructive">{mismatchError}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Resetting…" : "Reset password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
