import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ASSIGNABLE_STAFF_ROLES, USER_MANAGEMENT_ROLES, type UserRole } from "@/api/types";
import { listUsers } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/dashboard/StatTile";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The role filter must cover every role that can appear in this list, not
// just ASSIGNABLE_STAFF_ROLES (which is scoped to the create/edit UI) --
// a CANDIDATE-role login account is real seeded data (app/db/seed.py),
// not an error, and needs to be filterable like any other row.
const ALL_USER_ROLES: readonly UserRole[] = [...ASSIGNABLE_STAFF_ROLES, "CANDIDATE"];

const TOTAL_COLUMN_COUNT = 5;

export function UsersListPage() {
  const { user, hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL");
  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // Defaults to Active so deactivated accounts don't clutter the default
  // view -- still reachable via the Status filter for anyone who needs them.
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");

  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  // Bug fix (2026-08-24): OR'd with hasPermission("MANAGE_USERS") -- see
  // AppShell.tsx's NavItem.visibleForPermission comment for the full story.
  const canManage = Boolean(user && (USER_MANAGEMENT_ROLES.includes(user.role) || hasPermission?.("MANAGE_USERS")));

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = users?.filter((row) => {
    if (roleFilter !== "ALL" && row.role !== roleFilter) return false;
    if (campusFilter !== "ALL" && row.campus_id !== campusFilter) return false;
    if (statusFilter === "ACTIVE" && !row.is_active) return false;
    if (statusFilter === "INACTIVE" && row.is_active) return false;
    if (!normalizedSearch) return true;
    return row.full_name.toLowerCase().includes(normalizedSearch) || row.email.toLowerCase().includes(normalizedSearch);
  });

  // Step 7 KPI strip -- derived from `filteredUsers`, i.e. the exact rows the
  // table below renders, so every tile narrows identically to the search/
  // role/campus/status filters currently applied (same convention Step 6's
  // CandidatesListPage KPI strip established). No new fetch: every field
  // these tiles read (is_active, role) is already on UserRead and already
  // part of the `users` query this page fetches regardless. "Staff accounts"
  // (role !== CANDIDATE) is a real, non-redundant split -- this same page's
  // role filter already treats CANDIDATE as a distinct category of login
  // account from ASSIGNABLE_STAFF_ROLES (see ALL_USER_ROLES above), so
  // surfacing how many of the currently-filtered rows are staff vs. that
  // self-service candidate-portal role is meaningful, not just a re-slice of
  // Active/Inactive.
  const userRows = filteredUsers ?? [];
  const activeUserCount = userRows.filter((row) => row.is_active).length;
  const inactiveUserCount = userRows.filter((row) => !row.is_active).length;
  const staffUserCount = userRows.filter((row) => row.role !== "CANDIDATE").length;

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total users" value={userRows.length} isLoading={isLoading} icon={Users} iconColor="blue" />
        <StatTile
          label="Active"
          value={activeUserCount}
          isLoading={isLoading}
          accent="green"
          icon={UserPlus}
          iconColor="green"
        />
        <StatTile label="Inactive" value={inactiveUserCount} isLoading={isLoading} icon={UserMinus} iconColor="red" />
        <StatTile
          label="Staff accounts"
          value={staffUserCount}
          isLoading={isLoading}
          icon={ShieldCheck}
          iconColor="purple"
        />
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

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. Step 7: the
          hand-rolled <table>/<thead>/<tbody> markup itself is now the shared
          Table primitive (see components/ui/table.tsx), same swap every
          prior step made -- every column's exact content/formatting carries
          over unchanged, only the element names changed. */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT} loading />
              ) : !filteredUsers || filteredUsers.length === 0 ? (
                <TableEmpty colSpan={TOTAL_COLUMN_COUNT}>
                  {users && users.length > 0 ? "No users match these filters." : "No users found."}
                </TableEmpty>
              ) : (
                filteredUsers.map((row) => {
                  const campus = campuses?.find((c) => c.id === row.campus_id);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        {canManage ? (
                          <Link to={`/users/${row.id}`} className="font-medium hover:underline">
                            {row.full_name}
                          </Link>
                        ) : (
                          row.full_name
                        )}
                      </TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell>{row.role.replace(/_/g, " ")}</TableCell>
                      <TableCell className="font-mono text-xs">{campus?.code ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={row.is_active ? "success" : "destructive"}>
                          {row.is_active ? "Active" : "Inactive"}
                        </Badge>
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
