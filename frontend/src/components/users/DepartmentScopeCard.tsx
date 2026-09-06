import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import type { CampusRead, DepartmentRead, UserRole } from "@/api/types";
import { getUserDepartmentScope, setUserDepartmentScope } from "@/api/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Mirrors app/models/enums.py::DEPARTMENT_SCOPABLE_ROLES -- the only roles
// PUT /users/{id}/department-scope accepts. Independent of campus scope on
// purpose (see CLAUDE.md: the two sets are never re-merged).
const SCOPABLE_ROLES: UserRole[] = ["HR_ADMIN", "ASSOCIATE_DEAN_RECRUITMENT", "MANAGEMENT", "RECRUITMENT_COORDINATOR"];

interface DepartmentScopeCardProps {
  userId: string;
  targetRole: UserRole;
  /** GET is SUPER_ADMIN-or-self, PUT is SUPER_ADMIN only -- the card is
   * simply not rendered for any other viewer. */
  viewerIsSuperAdmin: boolean;
  campuses: CampusRead[];
  departments: DepartmentRead[];
}

export function DepartmentScopeCard({ userId, targetRole, viewerIsSuperAdmin, campuses, departments }: DepartmentScopeCardProps) {
  const queryClient = useQueryClient();
  const enabled = viewerIsSuperAdmin && SCOPABLE_ROLES.includes(targetRole);

  const { data, isLoading } = useQuery({
    queryKey: ["user-department-scope", userId],
    queryFn: () => getUserDepartmentScope(userId),
    enabled,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setSelected(data.department_ids);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => setUserDepartmentScope(userId, selected),
    onSuccess: (result) => {
      setError(null);
      setSaved(true);
      setSelected(result.department_ids);
      void queryClient.invalidateQueries({ queryKey: ["user-department-scope", userId] });
    },
    onError: (err) => {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : "Could not save the department scope");
    },
  });

  if (!enabled) return null;

  const current = new Set(data?.department_ids ?? []);
  const isDirty = selected.length !== current.size || selected.some((id) => !current.has(id));
  const activeDepartments = departments.filter((d) => d.is_active || selected.includes(d.id));
  const byCampus = campuses
    .map((campus) => ({ campus, rows: activeDepartments.filter((d) => d.campus_id === campus.id) }))
    .filter((group) => group.rows.length > 0);

  function toggle(id: string) {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Department Scope</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {selected.length === 0
            ? "No restriction: this user sees every department their campus scope allows."
            : `Restricted to ${selected.length} department${selected.length === 1 ? "" : "s"}. Vacancy requests, sanctioned strength and postings outside them are hidden.`}
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-3">
            {byCampus.map(({ campus, rows }) => (
              <div key={campus.id}>
                <div className="mb-1 font-mono text-xs text-muted-foreground">{campus.code}</div>
                <div className="flex flex-wrap gap-2">
                  {rows.map((department) => (
                    <Button
                      key={department.id}
                      type="button"
                      size="sm"
                      variant={selected.includes(department.id) ? "default" : "outline"}
                      aria-pressed={selected.includes(department.id)}
                      onClick={() => toggle(department.id)}
                    >
                      {department.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {saved ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!isDirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : "Save department scope"}
          </Button>
          {selected.length > 0 ? (
            <Button variant="outline" disabled={saveMutation.isPending} onClick={() => { setSaved(false); setSelected([]); }}>
              Clear restriction
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
