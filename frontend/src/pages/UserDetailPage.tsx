import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import { listAuditLogs } from "@/api/auditLogs";
import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import {
  ASSIGNABLE_STAFF_ROLES,
  COORDINATOR_CAPABILITIES,
  COORDINATOR_CAPABILITY_LABELS,
  SINGLE_CAMPUS_SCOPE_ROLES,
  USER_MANAGEMENT_ROLES,
  type AuditLogRead,
  type CoordinatorCapability,
  type Permission,
  type UserRole,
} from "@/api/types";
import {
  adminResetPassword,
  deleteUser,
  forceLogoutUser,
  getUser,
  getUserCapabilities,
  getUserPermissions,
  setUserCapabilities,
  setUserPermissions,
  updateUser,
} from "@/api/users";
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
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionCategoryCards } from "@/components/users/PermissionCategoryCards";
import { combine, minLength, required, useFieldValidation } from "@/hooks/useFieldValidation";

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Deterministic (same name always picks the same color), no new dependency --
// just a small rotation across colors already used elsewhere in this app's
// brand palette (index.css's --brand-* tokens).
const AVATAR_COLOR_CLASSES = [
  "bg-brand-primary/15 text-brand-primary",
  "bg-brand-plum/15 text-brand-plum",
  "bg-brand-info/15 text-brand-info",
  "bg-brand-success/15 text-brand-success",
  "bg-brand-warning/15 text-brand-warning",
];

function getAvatarColorClass(fullName: string): string {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash + fullName.charCodeAt(i)) % AVATAR_COLOR_CLASSES.length;
  }
  return AVATAR_COLOR_CLASSES[hash];
}

// Friendly labels for the Recent Activity feed. This will never be an
// exhaustive list of every action/entity_type combination the backend can
// log -- unmapped combinations fall back to a generic "{action} {entity}"
// string rather than a blank/unreadable row.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Logged in",
  LOGOUT: "Logged out",
  FORCE_LOGOUT: "Sessions force-logged-out",
};

const AUDIT_ACTION_ENTITY_LABELS: Record<string, string> = {
  "CREATE:VacancyRequest": "Vacancy request created",
  "UPDATE:VacancyRequest": "Vacancy request updated",
  "UPDATE:SanctionedStrength": "Sanctioned strength changed",
  "UPDATE:Employee": "Employee updated",
};

function describeAuditEntry(entry: AuditLogRead): string {
  const specificKey = `${entry.action}:${entry.entity_type ?? ""}`;
  if (AUDIT_ACTION_ENTITY_LABELS[specificKey]) return AUDIT_ACTION_ENTITY_LABELS[specificKey];
  if (AUDIT_ACTION_LABELS[entry.action]) return AUDIT_ACTION_LABELS[entry.action];
  if (entry.action === "DELETE" && entry.entity_type) return `${entry.entity_type} deleted`;
  return `${entry.action} ${entry.entity_type ?? ""}`.trim();
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser, hasPermission } = useAuth();
  const navigate = useNavigate();
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

  // GET /audit-logs is now gated server-side by the ACTIVITY_LOG permission
  // (app/api/v1/routers/audit_logs.py), individually grantable/revocable per
  // user rather than purely role-derived -- fetch the current viewer's own
  // permission grants (self-read is allowed for any authenticated user) and
  // check dynamically instead of a hardcoded role list, which would silently
  // drift the moment a user's grants differ from their role's default.
  // SUPER_ADMIN is special-cased true, mirroring app.services.permissions
  // .has_permission's own implicit "has every permission" bypass -- a
  // SUPER_ADMIN never has UserPermissionGrant rows of their own, so a bare
  // `.includes` would incorrectly hide this section for them.
  const { data: viewerPermissionsData } = useQuery({
    queryKey: ["user-permissions", currentUser?.id],
    queryFn: () => getUserPermissions(currentUser!.id),
    enabled: Boolean(currentUser?.id),
  });
  const canViewActivity =
    currentUser?.role === "SUPER_ADMIN" || Boolean(viewerPermissionsData?.permissions.includes("ACTIVITY_LOG"));
  const { data: activityEntries, isLoading: activityLoading } = useQuery({
    queryKey: ["audit-logs", "actor", id],
    queryFn: async () => {
      // TOKEN_REFRESHED fires on every token refresh -- pure noise in a
      // "recent activity for this user" feed. Fetch a larger page, filter it
      // out client-side, then take the 5 most recent of what remains. No
      // backend query param for this; the endpoint doesn't support it.
      const entries = await listAuditLogs({ actorUserId: id!, limit: 20 });
      return entries.filter((entry) => entry.action !== "TOKEN_REFRESHED").slice(0, 5);
    },
    enabled: Boolean(id) && canViewActivity,
  });

  // Visible to SUPER_ADMIN for any target except SUPER_ADMIN/CANDIDATE --
  // mirrors set_user_permissions' own 400 guard so this never renders a save
  // control that would just fail server-side. Requires `target` to have
  // actually loaded first: while it's still undefined, `undefined !==
  // "SUPER_ADMIN"` and `undefined !== "CANDIDATE"` would otherwise make this
  // evaluate true during every page's initial load, firing a premature (and,
  // for a real SUPER_ADMIN/CANDIDATE target, incorrect) permissions fetch.
  const canManagePermissions =
    currentUser?.role === "SUPER_ADMIN" &&
    Boolean(target) &&
    target?.role !== "SUPER_ADMIN" &&
    target?.role !== "CANDIDATE";
  const { data: targetPermissionsData } = useQuery({
    queryKey: ["user-permissions", id],
    queryFn: () => getUserPermissions(id!),
    enabled: Boolean(id) && canManagePermissions,
  });

  const [role, setRole] = useState<UserRole>("RECRUITMENT_OFFICER");
  const [campusId, setCampusId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<CoordinatorCapability[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([]);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [toggleActiveError, setToggleActiveError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // SUPER_ADMIN + HR_ADMIN (USER_MANAGEMENT_ROLES) -- mirrors
  // app/api/v1/routers/users.py::force_logout_user's own require_roles gate.
  const canForceLogout = Boolean(currentUser && USER_MANAGEMENT_ROLES.includes(currentUser.role));
  const [forceLogoutDialogOpen, setForceLogoutDialogOpen] = useState(false);
  const [forceLogoutSuccess, setForceLogoutSuccess] = useState(false);
  const [forceLogoutError, setForceLogoutError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!targetPermissionsData) return;
    setSelectedPermissions(targetPermissionsData.permissions);
  }, [targetPermissionsData]);

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
    mutationFn: () =>
      updateUser(id!, {
        role,
        campus_id: requiresCampus ? campusId || null : null,
        department_id: requiresCampus ? departmentId || null : null,
      }),
    onSuccess: () => {
      setError(null);
      setSaveSuccess(true);
      afterChange();
    },
    onError: (err) => {
      setSaveSuccess(false);
      setError(err instanceof ApiError ? err.message : "Update failed");
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () => updateUser(id!, { is_active: !target!.is_active }),
    onSuccess: () => {
      setToggleActiveError(null);
      setDeactivateDialogOpen(false);
      setReactivateDialogOpen(false);
      afterChange();
    },
    onError: (err) => setToggleActiveError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(id!),
    onSuccess: () => {
      setDeleteError(null);
      // The record no longer exists -- no point invalidating its own detail
      // query, but the list page's ["users"] query would otherwise show a
      // stale row for a user that's gone.
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      navigate("/users");
    },
    onError: (err) => setDeleteError(err instanceof ApiError ? err.message : "Delete failed"),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: () => forceLogoutUser(id!),
    onSuccess: () => {
      setForceLogoutError(null);
      setForceLogoutSuccess(true);
    },
    onError: (err) => {
      setForceLogoutSuccess(false);
      setForceLogoutError(err instanceof ApiError ? err.message : "Force logout failed");
    },
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

  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  // Parameterized (unlike saveCapabilitiesMutation above) rather than closing
  // over `selectedPermissions` -- PermissionCategoryCards' drawer computes
  // its own full-replace merge (this category's draft toggles folded into
  // the rest of `selectedPermissions`) and passes it straight through here,
  // the one and only code path that calls PUT /users/{id}/permissions.
  const savePermissionsMutation = useMutation({
    mutationFn: (permissions: Permission[]) => setUserPermissions(id!, permissions),
    onSuccess: () => {
      setPermissionsError(null);
      void queryClient.invalidateQueries({ queryKey: ["user-permissions", id] });
    },
    onError: (err) => setPermissionsError(err instanceof ApiError ? err.message : "Update failed"),
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

  function handleForceLogoutDialogChange(open: boolean) {
    setForceLogoutDialogOpen(open);
    if (!open) {
      setForceLogoutError(null);
      setForceLogoutSuccess(false);
    }
  }

  function handleDeactivateDialogChange(open: boolean) {
    setDeactivateDialogOpen(open);
    if (!open) setToggleActiveError(null);
  }

  function handleReactivateDialogChange(open: boolean) {
    setReactivateDialogOpen(open);
    if (!open) setToggleActiveError(null);
  }

  function handleDeleteDialogChange(open: boolean) {
    setDeleteDialogOpen(open);
    if (!open) setDeleteError(null);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  // Bug fix (2026-08-24): OR'd with hasPermission("MANAGE_USERS") -- mirrors
  // the backend's own require_permission(PermissionEnum.MANAGE_USERS) gate
  // on PATCH /users/{id} (this page's main edit action). canForceLogout/
  // canResetPassword/canDelete/canManageCapabilities below stay role-only
  // on purpose -- their backend endpoints are require_roles(...)-gated, not
  // permission-gated, so granting MANAGE_USERS alone shouldn't surface
  // those buttons (they'd just 403 if clicked).
  if (!target || !currentUser || (!USER_MANAGEMENT_ROLES.includes(currentUser.role) && !hasPermission?.("MANAGE_USERS"))) {
    return <Navigate to="/users" replace />;
  }

  const canDelete = currentUser.role === "SUPER_ADMIN" && target.role !== "SUPER_ADMIN" && !target.deactivation_protected;
  const lastLoginText = target.last_login_at ? new Date(target.last_login_at).toLocaleString() : "Never";
  const initials = getInitials(target.full_name);
  const avatarColorClass = getAvatarColorClass(target.full_name);
  const isDirty =
    role !== target.role || campusId !== (target.campus_id ?? "") || departmentId !== (target.department_id ?? "");
  const saveDisabled = saveMutation.isPending || !isDirty || (requiresCampus && !campusId);

  function handleRoleChange(value: UserRole) {
    setRole(value);
    setSaveSuccess(false);
  }

  function handleCampusChange(value: string) {
    setCampusId(value);
    setDepartmentId("");
    setSaveSuccess(false);
  }

  function handleDepartmentChange(value: string) {
    setDepartmentId(value);
    setSaveSuccess(false);
  }

  function handleCancel() {
    setRole(target!.role);
    setCampusId(target!.campus_id ?? "");
    setDepartmentId(target!.department_id ?? "");
    setError(null);
    setSaveSuccess(false);
  }

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>Administration</span>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        <Link to="/users" className="transition-colors hover:text-foreground hover:underline">
          Users
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="text-foreground">{target.full_name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarColorClass}`}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{target.full_name}</h1>
              <Badge variant="outline">{target.role.replace(/_/g, " ")}</Badge>
              <Badge variant={target.is_active ? "success" : "destructive"}>
                {target.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{target.email}</p>
            <p className="text-xs text-muted-foreground">Last login: {lastLoginText}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/users">Back to Users</Link>
          </Button>
          <Popover open={moreActionsOpen} onOpenChange={setMoreActionsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1">
              <div className="flex flex-col">
                {target.is_active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    disabled={target.deactivation_protected}
                    onClick={() => {
                      setMoreActionsOpen(false);
                      setDeactivateDialogOpen(true);
                    }}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setMoreActionsOpen(false);
                      setReactivateDialogOpen(true);
                    }}
                  >
                    Activate
                  </Button>
                )}
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={() => {
                      setMoreActionsOpen(false);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
              {target.is_active && target.deactivation_protected ? (
                <p className="mt-1 px-2 text-xs text-muted-foreground">This account is protected from deactivation.</p>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Dialog open={deactivateDialogOpen} onOpenChange={handleDeactivateDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate user</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Deactivate <span className="font-medium text-foreground">{target.full_name}</span>? They will lose
            access until reactivated.
          </p>
          {toggleActiveError ? <p className="text-sm text-destructive">{toggleActiveError}</p> : null}
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

      <Dialog open={reactivateDialogOpen} onOpenChange={handleReactivateDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivate user</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reactivate <span className="font-medium text-foreground">{target.full_name}</span>? They will regain
            access immediately.
          </p>
          {toggleActiveError ? <p className="text-sm text-destructive">{toggleActiveError}</p> : null}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={toggleActiveMutation.isPending}
              onClick={() => toggleActiveMutation.mutate()}
            >
              {toggleActiveMutation.isPending ? "Reactivating…" : "Confirm reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{target.full_name}</span>? This cannot be undone.
          </p>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <DialogFooter>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              <div className="text-muted-foreground">Status</div>
              <Badge variant={target.is_active ? "success" : "destructive"}>
                {target.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div>
              <div className="text-muted-foreground">Last Login</div>
              <div>{lastLoginText}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access Control</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Role</span>
              <Select value={role} onValueChange={(value) => handleRoleChange(value as UserRole)}>
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

            {requiresCampus ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Campus</span>
                <Select value={campusId} onValueChange={handleCampusChange}>
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
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Campus</span>
                <p className="text-sm">All Campuses</p>
              </div>
            )}

            {requiresCampus ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Department (optional)</span>
                <Select value={departmentId} onValueChange={handleDepartmentChange} disabled={!campusId}>
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
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Department</span>
                <p className="text-sm">All Departments</p>
              </div>
            )}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {saveSuccess ? <p className="text-sm text-muted-foreground">Saved.</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button disabled={saveDisabled} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
              <Button variant="outline" disabled={!isDirty} onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Security</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Last Login</span>
                <span className="text-sm">{lastLoginText}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Password status</span>
                <div>
                  <Badge variant={target.must_change_password ? "warning" : "success"}>
                    {target.must_change_password ? "Must change password" : "Password set"}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
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

              {canForceLogout ? (
                <Dialog open={forceLogoutDialogOpen} onOpenChange={handleForceLogoutDialogChange}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Force logout</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Sign out all sessions</DialogTitle>
                    </DialogHeader>
                    {forceLogoutSuccess ? (
                      <p className="text-sm text-muted-foreground">All sessions ended.</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Sign out all sessions for{" "}
                          <span className="font-medium text-foreground">{target.full_name}</span>? They will need to
                          log in again on every device.
                        </p>
                        <DialogFooter>
                          <Button
                            variant="destructive"
                            disabled={forceLogoutMutation.isPending}
                            onClick={() => forceLogoutMutation.mutate()}
                          >
                            {forceLogoutMutation.isPending ? "Signing out…" : "Confirm sign out"}
                          </Button>
                        </DialogFooter>
                      </>
                    )}
                    {forceLogoutError ? <p className="text-sm text-destructive">{forceLogoutError}</p> : null}
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {canViewActivity ? (
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link to="/activity-log">View Activity Log</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !activityEntries || activityEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity for this user.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {activityEntries.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span>{describeAuditEntry(entry)}</span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {canManageCapabilities && isCoordinator ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Coordinator capabilities</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                A Recruitment Coordinator only gets write access to these action groups if granted here -- unlike
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

        {canManagePermissions ? (
          <Card className="border-brand-primary/20 bg-brand-primary/5 backdrop-blur-sm lg:col-span-2">
            <CardHeader>
              <CardTitle>Permission Matrix</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Grant or revoke fine-grained access for this user, grouped by area. This full-replace matrix is
                independent of any Coordinator capabilities above.
              </p>

              <PermissionCategoryCards
                permissions={selectedPermissions}
                onPermissionsChange={setSelectedPermissions}
                onSave={(permissions, options) => savePermissionsMutation.mutate(permissions, options)}
                isSaving={savePermissionsMutation.isPending}
                saveError={permissionsError}
                onDrawerOpen={() => setPermissionsError(null)}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
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
        <PasswordInput
          id="reset_new_password"
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
        <PasswordInput
          id="reset_confirm_password"
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
