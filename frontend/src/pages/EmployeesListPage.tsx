import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listEmployees } from "@/api/employees";
import { Input } from "@/components/ui/input";

export function EmployeesListPage() {
  const [search, setSearch] = useState("");

  const { data: employees, isLoading } = useQuery({ queryKey: ["employees"], queryFn: listEmployees });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const normalizedSearch = search.trim().toLowerCase();
  const filteredEmployees = employees?.filter((employee) => {
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

      <div className="w-72">
        <Input
          placeholder="Search by name, email, or employee code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filteredEmployees || filteredEmployees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No employees found.</p>
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
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map((employee) => {
              const department = departments?.find((d) => d.id === employee.department_id);
              const campus = campuses?.find((c) => c.id === employee.campus_id);
              return (
                <tr key={employee.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/employees/${employee.id}`} className="font-medium hover:underline">
                      {employee.employee_code}
                    </Link>
                  </td>
                  <td className="py-2">{employee.full_name}</td>
                  <td className="py-2">{employee.designation}</td>
                  <td className="py-2">{department?.name ?? "—"}</td>
                  <td className="py-2">{campus?.code ?? "—"}</td>
                  <td className="py-2">{employee.email}</td>
                  <td className="py-2">{new Date(employee.date_of_joining).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
