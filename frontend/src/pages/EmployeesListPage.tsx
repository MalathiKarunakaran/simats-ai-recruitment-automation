import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listEmployees } from "@/api/employees";
import type { EmploymentStatus } from "@/api/types";
import { StatusBadge } from "@/components/employees/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPLOYMENT_STATUSES: EmploymentStatus[] = ["ACTIVE", "RESIGNED", "TERMINATED", "RETIRED"];

export function EmployeesListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmploymentStatus | "ALL">("ALL");

  const { data: employees, isLoading } = useQuery({ queryKey: ["employees"], queryFn: listEmployees });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");

  const normalizedSearch = search.trim().toLowerCase();
  const filteredEmployees = employees?.filter((employee) => {
    if (statusFilter !== "ALL" && employee.employment_status !== statusFilter) return false;
    if (campusFilter !== "ALL" && employee.campus_id !== campusFilter) return false;
    if (departmentFilter !== "ALL" && employee.department_id !== departmentFilter) return false;
    if (!normalizedSearch) return true;
    return (
      employee.full_name.toLowerCase().includes(normalizedSearch) ||
      employee.email.toLowerCase().includes(normalizedSearch) ||
      employee.employee_code.toLowerCase().includes(normalizedSearch)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Employees</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by name, email, or employee code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EmploymentStatus | "ALL")}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All employment statuses</SelectItem>
              {EMPLOYMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={campusFilter} onValueChange={setCampusFilter}>
            <SelectTrigger aria-label="Campus filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All campuses</SelectItem>
              {campuses?.map((campus) => (
                <SelectItem key={campus.id} value={campus.id}>
                  {campus.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger aria-label="Department filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              {departments?.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filteredEmployees || filteredEmployees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {employees && employees.length > 0
            ? "No employees match these filters."
            : "No employees in this scope yet."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Employee code</th>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Designation</th>
              <th className="py-2 font-medium">Department</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Date of joining</th>
              <th className="py-2 font-medium">Employment status</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map((employee) => {
              const department = departments?.find((d) => d.id === employee.department_id);
              const campus = campuses?.find((c) => c.id === employee.campus_id);
              return (
                <tr key={employee.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/employees/${employee.id}`} className="font-mono text-xs font-medium hover:underline">
                      {employee.employee_code}
                    </Link>
                  </td>
                  <td className="py-2">{employee.full_name}</td>
                  <td className="py-2">{employee.designation}</td>
                  <td className="py-2">{department?.name ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">{employee.email}</td>
                  <td className="py-2">{new Date(employee.date_of_joining).toLocaleDateString()}</td>
                  <td className="py-2">
                    <StatusBadge status={employee.employment_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
