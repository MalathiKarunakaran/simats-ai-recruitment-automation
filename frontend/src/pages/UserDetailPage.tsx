import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { getUser, getUserCapabilities, setUserCapabilities, updateUser } from "@/api/users";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
                  <Button variant="outline">Deactivate</Button>
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
          </div>
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
