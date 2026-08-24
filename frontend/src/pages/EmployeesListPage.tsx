import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listEmployees } from "@/api/employees";
import type { EmploymentStatus } from "@/api/types";
import { StatusBadge } from "@/components/employees/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TOTAL_COLUMN_COUNT = 8;

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

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Date of joining</TableHead>
                <TableHead>Employment status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !filteredEmployees || filteredEmployees.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {employees && employees.length > 0
                    ? "No employees match these filters."
                    : "No employees in this scope yet."}
                </TableEmpty>
              ) : (
                filteredEmployees.map((employee) => {
                  const department = departments?.find((d) => d.id === employee.department_id);
                  const campus = campuses?.find((c) => c.id === employee.campus_id);
                  return (
                    <TableRow key={employee.id}>
                      <TableCell>
                        <Link
                          to={`/employees/${employee.id}`}
                          className="font-mono text-xs font-medium hover:underline"
                        >
                          {employee.employee_code}
                        </Link>
                      </TableCell>
                      <TableCell>{employee.full_name}</TableCell>
                      <TableCell>{employee.designation}</TableCell>
                      <TableCell>{department?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{campus?.code ?? "—"}</TableCell>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>{new Date(employee.date_of_joining).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <StatusBadge status={employee.employment_status} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
