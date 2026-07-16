import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { USER_MANAGEMENT_ROLES } from "@/api/types";
import { listUsers } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function UsersListPage() {
  const { user } = useAuth();

  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && USER_MANAGEMENT_ROLES.includes(user.role));

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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !users || users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
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
            {users.map((row) => {
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
