import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { getEmployee, offboardEmployee } from "@/api/employees";
import type { EmploymentStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/employees/StatusBadge";
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
import { Textarea } from "@/components/ui/textarea";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

// Mirrors the backend's HR_ADMIN/SUPER_ADMIN-only gate on
// POST /employees/{id}/offboard (app/api/v1/routers/employees.py).
const CAN_OFFBOARD_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

const SEPARATION_TYPES: Exclude<EmploymentStatus, "ACTIVE">[] = ["RESIGNED", "TERMINATED", "RETIRED"];

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [offboardDialogOpen, setOffboardDialogOpen] = useState(false);
  const [separationType, setSeparationType] = useState<Exclude<EmploymentStatus, "ACTIVE"> | "">("");
  const [separationDate, setSeparationDate] = useState("");
  const reason = useFieldValidation("", required());

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => getEmployee(id!),
    enabled: Boolean(id),
  });

  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const offboardMutation = useMutation({
    mutationFn: () =>
      offboardEmployee(id!, {
        separation_type: separationType as Exclude<EmploymentStatus, "ACTIVE">,
        separation_date: separationDate,
        reason: reason.value,
      }),
    onSuccess: () => {
      setError(null);
      setOffboardDialogOpen(false);
      setSeparationType("");
      setSeparationDate("");
      void queryClient.invalidateQueries({ queryKey: ["employee", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Offboard failed"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!employee) {
    return <Navigate to="/employees" replace />;
  }

  const department = departments?.find((d) => d.id === employee.department_id);
  const campus = campuses?.find((c) => c.id === employee.campus_id);

  const canOffboard = Boolean(user && CAN_OFFBOARD_ROLES.includes(user.role));
  const isActive = employee.employment_status === "ACTIVE";

  function submitOffboard() {
    if (!reason.validate() || !separationType || !separationDate) return;
    offboardMutation.mutate();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{employee.full_name}</h1>
          <div className="mt-1">
            <StatusBadge status={employee.employment_status} />
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/employees">Back to list</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Employee record</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Employee code</div>
            <div className="font-mono text-xs">{employee.employee_code}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Designation</div>
            <div>{employee.designation}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Department</div>
            <div>{department?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Campus</div>
            <div>{campus?.code ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{employee.email}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div>{employee.phone_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Date of joining</div>
            <div>{new Date(employee.date_of_joining).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Created</div>
            <div>{new Date(employee.created_at).toLocaleDateString()}</div>
          </div>
          <div className="col-span-2">
            <div className="text-muted-foreground">Source application</div>
            <Link to={`/applications/${employee.application_id}`} className="hover:underline">
              View application
            </Link>
          </div>
        </CardContent>
      </Card>

      {!isActive ? (
        <Card>
          <CardHeader>
            <CardTitle>Separation details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Separation type</div>
              <div>{employee.employment_status}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Separation date</div>
              <div>{employee.separation_date ? new Date(employee.separation_date).toLocaleDateString() : "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">Reason</div>
              <div>{employee.separation_reason ?? "—"}</div>
            </div>
            {employee.separated_by_id ? (
              <div className="col-span-2">
                <div className="text-muted-foreground">Recorded by</div>
                <div className="font-mono text-xs">{employee.separated_by_id}</div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {isActive && canOffboard ? (
        <div>
          <Dialog open={offboardDialogOpen} onOpenChange={setOffboardDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">Offboard</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Offboard employee</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Separation type</Label>
                  <Select
                    value={separationType}
                    onValueChange={(v) => setSeparationType(v as Exclude<EmploymentStatus, "ACTIVE">)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a separation type" />
                    </SelectTrigger>
                    <SelectContent>
                      {SEPARATION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.charAt(0) + type.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="separation_date">Separation date</Label>
                  <Input
                    id="separation_date"
                    type="date"
                    value={separationDate}
                    onChange={(e) => setSeparationDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="separation_reason">Reason</Label>
                  <Textarea
                    id="separation_reason"
                    required
                    value={reason.value}
                    onChange={(e) => reason.onChange(e.target.value)}
                    onBlur={reason.onBlur}
                  />
                  {reason.error ? <p className="text-sm text-destructive">{reason.error}</p> : null}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={!separationType || !separationDate || !reason.value.trim() || offboardMutation.isPending}
                  onClick={submitOffboard}
                >
                  {offboardMutation.isPending ? "Offboarding…" : "Confirm offboard"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
