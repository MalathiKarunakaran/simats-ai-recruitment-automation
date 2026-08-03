import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ASSIGNABLE_STAFF_ROLES, USER_MANAGEMENT_ROLES, type UserRole } from "@/api/types";
import { listUsers } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The role filter must cover every role that can appear in this list, not
// just ASSIGNABLE_STAFF_ROLES (which is scoped to the create/edit UI) --
// a CANDIDATE-role login account is real seeded data (app/db/seed.py),
// not an error, and needs to be filterable like any other row.
const ALL_USER_ROLES: readonly UserRole[] = [...ASSIGNABLE_STAFF_ROLES, "CANDIDATE"];

export function UsersListPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // Defaults to Active so deactivated accounts don't clutter the default
  // view -- still reachable via the Status filter for anyone who needs them.
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");

  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && USER_MANAGEMENT_ROLES.includes(user.role));

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = users?.filter((row) => {
    if (roleFilter !== "ALL" && row.role !== roleFilter) return false;
    if (campusFilter !== "ALL" && row.campus_id !== campusFilter) return false;
    if (statusFilter === "ACTIVE" && !row.is_active) return false;
    if (statusFilter === "INACTIVE" && row.is_active) return false;
    if (!normalizedSearch) return true;
    return row.full_name.toLowerCase().includes(normalizedSearch) || row.email.toLowerCase().includes(normalizedSearch);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Users</h1>
        {canManage ? (
          <Button asChild>
            <Link to="/users/new">New user</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Input
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "ALL")}>
            <SelectTrigger aria-label="Role filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {ALL_USER_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role.replace(/_/g, " ")}
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
        <div className="w-48">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "ALL" | "ACTIVE" | "INACTIVE")}>
            <SelectTrigger aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !filteredUsers || filteredUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {users && users.length > 0 ? "No users match these filters." : "No users found."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((row) => {
              const campus = campuses?.find((c) => c.id === row.campus_id);
              return (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    {canManage ? (
                      <Link to={`/users/${row.id}`} className="font-medium hover:underline">
                        {row.full_name}
                      </Link>
                    ) : (
                      row.full_name
                    )}
                  </td>
                  <td className="py-2">{row.email}</td>
                  <td className="py-2">{row.role.replace(/_/g, " ")}</td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">
                    <Badge variant={row.is_active ? "success" : "destructive"}>
                      {row.is_active ? "Active" : "Inactive"}
                    </Badge>
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
