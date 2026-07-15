import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { getEmployee } from "@/api/employees";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => getEmployee(id!),
    enabled: Boolean(id),
  });

  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!employee) {
    return <Navigate to="/employees" replace />;
  }

  const department = departments?.find((d) => d.id === employee.department_id);
  const campus = campuses?.find((c) => c.id === employee.campus_id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{employee.full_name}</h1>
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
    </div>
  );
}
