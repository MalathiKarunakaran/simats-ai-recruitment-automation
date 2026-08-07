import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { createEligibilityRule, listEligibilityRules, updateEligibilityRule } from "@/api/eligibilityRules";
import { ELIGIBILITY_RULE_MANAGEMENT_ROLES, type EligibilityRule, type StaffRoleCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const STAFF_CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

interface FormState {
  campusId: string;
  staffCategory: StaffRoleCategory;
  positionTitle: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  campusId: "",
  staffCategory: "TEACHING",
  positionTitle: "",
  isActive: true,
};

export function EligibilityRulesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const keyword = useFieldValidation("", required("Required qualification keyword is required"));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<StaffRoleCategory | "ALL">("ALL");
  // Defaults to Active-only, same as Departments/Users -- a handful of
  // deactivated rules (e.g. the retired Admission Officer keyword) shouldn't
  // clutter the default view; still reachable via this filter.
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  const [search, setSearch] = useState("");

  const { data: rules, isLoading } = useQuery({ queryKey: ["eligibility-rules"], queryFn: listEligibilityRules });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && ELIGIBILITY_RULE_MANAGEMENT_ROLES.includes(user.role));

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRules = rules?.filter((rule) => {
    if (campusFilter !== "ALL" && rule.campus_id !== campusFilter) return false;
    if (categoryFilter !== "ALL" && rule.staff_category !== categoryFilter) return false;
    if (activeFilter !== "ALL" && rule.is_active !== (activeFilter === "true")) return false;
    if (!normalizedSearch) return true;
    return (
      rule.required_qualification_keyword.toLowerCase().includes(normalizedSearch) ||
      (rule.position_title?.toLowerCase().includes(normalizedSearch) ?? false) ||
      (rule.notes?.toLowerCase().includes(normalizedSearch) ?? false)
    );
  });

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    setEditingRuleId(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createEligibilityRule({
        campus_id: form.campusId,
        staff_category: form.staffCategory,
        position_title: form.positionTitle.trim() || null,
        required_qualification_keyword: keyword.value,
        is_active: form.isActive,
        notes: notes.trim() || null,
      }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create rule"),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateEligibilityRule(editingRuleId!, {
        campus_id: form.campusId,
        staff_category: form.staffCategory,
        position_title: form.positionTitle.trim() || null,
        required_qualification_keyword: keyword.value,
        is_active: form.isActive,
        notes: notes.trim() || null,
      }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update rule"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateEligibilityRule(id, { is_active: isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update rule"),
  });

  function openCreateDialog() {
    setEditingRuleId(null);
    setForm(EMPTY_FORM);
    keyword.onChange("");
    setNotes("");
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(rule: EligibilityRule) {
    setEditingRuleId(rule.id);
    setForm({
      campusId: rule.campus_id,
      staffCategory: rule.staff_category,
      positionTitle: rule.position_title ?? "",
      isActive: rule.is_active,
    });
    keyword.onChange(rule.required_qualification_keyword);
    setNotes(rule.notes ?? "");
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!keyword.validate() || !form.campusId) return;
    if (editingRuleId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!user || user.role === "CANDIDATE") {
    return <p className="text-sm text-muted-foreground">Only staff can view eligibility rules.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Eligibility Rules</h1>
        {canManage ? (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>New rule</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingRuleId ? "Edit eligibility rule" : "New eligibility rule"}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Campus</Label>
                  <Select value={form.campusId} onValueChange={(v) => setForm((f) => ({ ...f, campusId: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a campus" />
                    </SelectTrigger>
                    <SelectContent>
                      {campuses?.map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campus.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Staff category</Label>
                  <Select
                    value={form.staffCategory}
                    onValueChange={(v) => setForm((f) => ({ ...f, staffCategory: v as StaffRoleCategory }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="position_title">Position title (optional)</Label>
                  <Input
                    id="position_title"
                    placeholder="Leave blank to apply to all positions in this category"
                    value={form.positionTitle}
                    onChange={(e) => setForm((f) => ({ ...f, positionTitle: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="keyword">Required qualification keyword</Label>
                  <Input
                    id="keyword"
                    required
                    placeholder="e.g. PHD"
                    value={keyword.value}
                    onChange={(e) => keyword.onChange(e.target.value)}
                    onBlur={keyword.onBlur}
                    aria-invalid={Boolean(keyword.error)}
                  />
                  {keyword.error ? <p className="text-xs text-destructive">{keyword.error}</p> : null}
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button disabled={!form.campusId || !keyword.value.trim() || isSaving} onClick={submit}>
                  {isSaving ? "Saving…" : editingRuleId ? "Save changes" : "Create rule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {error && !dialogOpen ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search position, keyword, or notes"
          className="sm:w-64"
        />
        <Select value={campusFilter} onValueChange={setCampusFilter}>
          <SelectTrigger aria-label="Campus filter" className="sm:w-40">
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
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as StaffRoleCategory | "ALL")}>
          <SelectTrigger aria-label="Category filter" className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {STAFF_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {category.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rules || rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No eligibility rules found.</p>
      ) : !filteredRules || filteredRules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No eligibility rules match these filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Staff category</th>
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Required keyword</th>
              <th className="py-2 font-medium">Active</th>
              <th className="py-2 font-medium">Notes</th>
              {canManage ? <th className="py-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {filteredRules.map((rule) => {
              const campus = campuses?.find((c) => c.id === rule.campus_id);
              return (
                <tr key={rule.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">{rule.staff_category.replace(/_/g, " ")}</td>
                  <td className="py-2">{rule.position_title ?? "All positions"}</td>
                  <td className="py-2">{rule.required_qualification_keyword}</td>
                  <td className="py-2">
                    {canManage ? (
                      <button
                        type="button"
                        disabled={toggleActiveMutation.isPending}
                        onClick={() => toggleActiveMutation.mutate({ id: rule.id, isActive: !rule.is_active })}
                      >
                        <Badge variant={rule.is_active ? "success" : "destructive"}>
                          {rule.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </button>
                    ) : (
                      <Badge variant={rule.is_active ? "success" : "destructive"}>
                        {rule.is_active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2">{rule.notes ?? "—"}</td>
                  {canManage ? (
                    <td className="py-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(rule)}>
                        Edit
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
