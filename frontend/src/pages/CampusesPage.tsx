import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { createCampus, deleteCampus, listCampuses, updateCampus } from "@/api/campuses";
import { CAMPUS_CODES, type CampusCode, type CampusRead } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";
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
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

// Mirrors app/api/v1/routers/campuses.py: create_campus/update_campus both
// require SUPER_ADMIN exactly -- list/get are open to any authenticated
// staff member, same broad-read/narrow-write split as Designations.
const CAMPUS_WRITE_ROLES = ["SUPER_ADMIN"];

interface FormState {
  code: CampusCode | "";
  name: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { code: "", name: "", isActive: true };

export function CampusesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Campus name is required"));
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("ALL");

  const { data: campuses, isLoading } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && CAMPUS_WRITE_ROLES.includes(user.role));

  // Campus.code is a fixed institutional allowlist, one campus per code --
  // a code already in use (active or not) can't be picked again for a new
  // campus, mirroring the DB's own unique constraint.
  const usedCodes = new Set((campuses ?? []).map((c) => c.code));
  const availableCodes = CAMPUS_CODES.filter((code) => !usedCodes.has(code));

  const visibleCampuses = (campuses ?? []).filter((c) => {
    if (activeFilter === "ALL") return true;
    return activeFilter === "true" ? c.is_active : !c.is_active;
  });
  const filtersActive = activeFilter !== "ALL";

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    setEditingId(null);
    void queryClient.invalidateQueries({ queryKey: ["campuses"] });
  }

  const createMutation = useMutation({
    mutationFn: () => createCampus({ code: form.code as CampusCode, name: name.value, is_active: form.isActive }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create campus"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateCampus(editingId!, { name: name.value, is_active: form.isActive }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update campus"),
  });

  function openCreateDialog() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    name.onChange("");
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(campus: CampusRead) {
    setEditingId(campus.id);
    setForm({ code: campus.code, name: campus.name, isActive: campus.is_active });
    name.onChange(campus.name);
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!name.validate()) return;
    if (!editingId && !form.code) {
      setError("Pick an institutional code.");
      return;
    }
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!user || user.role === "CANDIDATE") {
    return <p className="text-sm text-muted-foreground">Only staff can view Campuses.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campuses"
        description="The institutional campus list -- code, display name, and active status."
        actions={
          canManage ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreateDialog} disabled={availableCodes.length === 0 && !editingId}>
                  New campus
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit campus" : "New campus"}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>Institutional code</Label>
                    <Select
                      value={form.code}
                      onValueChange={(v) => setForm((f) => ({ ...f, code: v as CampusCode }))}
                      disabled={Boolean(editingId)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a code" />
                      </SelectTrigger>
                      <SelectContent>
                        {(editingId ? [form.code as CampusCode] : availableCodes).map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {editingId ? (
                      <p className="text-xs text-muted-foreground">
                        Code can't be changed after a campus is created.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="campus_name">Name</Label>
                    <Input
                      id="campus_name"
                      required
                      value={name.value}
                      onChange={(e) => name.onChange(e.target.value)}
                      onBlur={name.onBlur}
                      aria-invalid={Boolean(name.error)}
                    />
                    {name.error ? <p className="text-xs text-destructive">{name.error}</p> : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Active</Label>
                    <Select
                      value={form.isActive ? "true" : "false"}
                      onValueChange={(v) => setForm((f) => ({ ...f, isActive: v === "true" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Active</SelectItem>
                        <SelectItem value="false">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button disabled={isSaving} onClick={submit}>
                    {isSaving ? "Saving…" : editingId ? "Save changes" : "Create campus"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as "ALL" | "true" | "false")}>
          <SelectTrigger aria-label="Active filter" className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : visibleCampuses.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {filtersActive ? "No campuses match the current filter." : "No campuses found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Code</th>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Active</th>
                    {canManage ? <th className="py-2 font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleCampuses.map((campus) => (
                    <tr key={campus.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                      <td className="py-2 font-mono font-medium text-foreground">{campus.code}</td>
                      <td className="py-2">{campus.name}</td>
                      <td className="py-2">
                        <Badge variant={campus.is_active ? "success" : "destructive"}>
                          {campus.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      {canManage ? (
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(campus)}>
                              Edit
                            </Button>
                            <DeleteConfirmDialog
                              triggerAriaLabel={`Delete campus ${campus.code}`}
                              title="Delete campus"
                              description={
                                <>
                                  Remove <span className="font-medium text-foreground">{campus.name}</span> (
                                  {campus.code})? This is a soft delete -- the campus stays visible (as Inactive)
                                  and can be reactivated later.
                                </>
                              }
                              onDelete={() => deleteCampus(campus.id)}
                              onDeleted={() => void queryClient.invalidateQueries({ queryKey: ["campuses"] })}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
