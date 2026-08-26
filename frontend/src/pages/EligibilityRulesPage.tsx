import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Plus, X } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import {
  createEligibilityRule,
  deleteEligibilityRule,
  duplicateEligibilityRule,
  exportEligibilityRules,
  listEligibilityRules,
  updateEligibilityRule,
  type EligibilityRuleSortBy,
  type EligibilityRuleSortDirection,
} from "@/api/eligibilityRules";
import {
  ELIGIBILITY_RULE_MANAGEMENT_ROLES,
  type EligibilityRule,
  type EligibilityRuleStatus,
  type RegulatoryAuthority,
  type StaffRoleCategory,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { EligibilityRuleBulkUploadDialog } from "@/components/eligibilityRules/EligibilityRuleBulkUploadDialog";
import { EligibilityRuleDetailDrawer } from "@/components/eligibilityRules/EligibilityRuleDetailDrawer";
import {
  ELIGIBILITY_RULE_STATUSES,
  ELIGIBILITY_RULE_STATUS_LABELS,
  REGULATORY_AUTHORITIES,
  REGULATORY_AUTHORITY_LABELS,
  boolToTriState,
  triStateToBool,
  type TriState,
} from "@/components/eligibilityRules/labels";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";
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
import { Pagination } from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const STAFF_CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];
const DEFAULT_LIMIT = 50;

interface FormState {
  campusId: string;
  departmentId: string; // "" = none (applies broadly, no single department)
  staffCategory: StaffRoleCategory;
  positionTitle: string;
  netSetRequired: TriState;
  subject: string;
  skillsKeyword: string;
  idProofRequired: TriState;
  shiftPreference: string;
  regulatoryAuthority: RegulatoryAuthority | "";
  schoolOrCollege: string;
  programmeDiscipline: string;
  minimumQualification: string;
  minimumPercentage: string;
  requiredExperience: string;
  requiredCredential: string;
  requiredKeywords: string;
  preferredKeywords: string;
  phdRequired: TriState;
  professionalRegistration: string;
  industryExperience: string;
  priority: string;
  effectiveFrom: string;
  effectiveTo: string;
  sourceRegulation: string;
  status: EligibilityRuleStatus;
  verificationRequired: boolean;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM: FormState = {
  campusId: "",
  departmentId: "",
  staffCategory: "TEACHING",
  positionTitle: "",
  netSetRequired: "UNSET",
  subject: "",
  skillsKeyword: "",
  idProofRequired: "UNSET",
  shiftPreference: "",
  regulatoryAuthority: "",
  schoolOrCollege: "",
  programmeDiscipline: "",
  minimumQualification: "",
  minimumPercentage: "",
  requiredExperience: "",
  requiredCredential: "",
  requiredKeywords: "",
  preferredKeywords: "",
  phdRequired: "UNSET",
  professionalRegistration: "",
  industryExperience: "",
  priority: "",
  effectiveFrom: "",
  effectiveTo: "",
  sourceRegulation: "",
  status: "DRAFT",
  verificationRequired: true,
  isActive: true,
  notes: "",
};

interface ColumnDef {
  key: string;
  label: string;
  sortBy?: EligibilityRuleSortBy;
}

// Only the columns the backend's own _SORT_FIELDS supports get an
// onSort-toggle header (Authority/Category/Position/Status); Campus/School/
// Department/Qualification/Experience render as plain, non-clickable
// headers -- mirrors DepartmentsPage's own COLUMNS shape/comment.
const COLUMNS: ColumnDef[] = [
  { key: "campus", label: "Campus" },
  { key: "authority", label: "Authority", sortBy: "regulatory_authority" },
  { key: "school", label: "School" },
  { key: "category", label: "Category", sortBy: "staff_category" },
  { key: "department", label: "Department" },
  { key: "position", label: "Position", sortBy: "position_title" },
  { key: "qualification", label: "Qualification" },
  { key: "experience", label: "Experience" },
  { key: "status", label: "Status", sortBy: "status" },
];

function formStateFromRule(rule: EligibilityRule): FormState {
  return {
    campusId: rule.campus_id,
    departmentId: rule.department_id ?? "",
    staffCategory: rule.staff_category,
    positionTitle: rule.position_title ?? "",
    netSetRequired: boolToTriState(rule.net_set_required),
    subject: rule.subject ?? "",
    skillsKeyword: rule.skills_keyword ?? "",
    idProofRequired: boolToTriState(rule.id_proof_required),
    shiftPreference: rule.shift_preference ?? "",
    regulatoryAuthority: rule.regulatory_authority ?? "",
    schoolOrCollege: rule.school_or_college ?? "",
    programmeDiscipline: rule.programme_discipline ?? "",
    minimumQualification: rule.minimum_qualification ?? "",
    minimumPercentage: rule.minimum_percentage ?? "",
    requiredExperience: rule.required_experience ?? "",
    requiredCredential: rule.required_credential ?? "",
    requiredKeywords: rule.required_keywords ?? "",
    preferredKeywords: rule.preferred_keywords ?? "",
    phdRequired: boolToTriState(rule.phd_required),
    professionalRegistration: rule.professional_registration ?? "",
    industryExperience: rule.industry_experience ?? "",
    priority: rule.priority ?? "",
    effectiveFrom: rule.effective_from ?? "",
    effectiveTo: rule.effective_to ?? "",
    sourceRegulation: rule.source_regulation ?? "",
    status: rule.status,
    verificationRequired: rule.verification_required,
    isActive: rule.is_active,
    notes: rule.notes ?? "",
  };
}

// 3-dot row-actions Popover -- View (always, any non-CANDIDATE staff role
// that can reach this page at all) / Edit / Duplicate / Deactivate / Delete
// (all 4 gated on canManage). 5 actions is more than fits as inline
// buttons, same reasoning DepartmentsPage's own row-actions Popover was
// introduced for. DeleteConfirmDialog is kept fully controlled and OUTSIDE
// PopoverContent for the same unmount-races-the-Dialog-Portal reason
// DepartmentRowActions documents -- see that component's own comment.
function EligibilityRuleRowActions({
  rule,
  canManage,
  onView,
  onEdit,
  onDuplicate,
  onDeactivate,
  onDeleted,
}: {
  rule: EligibilityRule;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDeactivate: () => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const label = rule.position_title ?? rule.required_qualification_keyword;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={`More actions for ${label}`}>
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          <div className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                setOpen(false);
                onView();
              }}
            >
              View
            </Button>
            {canManage ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setOpen(false);
                    onEdit();
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setOpen(false);
                    onDuplicate();
                  }}
                >
                  Duplicate
                </Button>
                {rule.is_active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setOpen(false);
                      onDeactivate();
                    }}
                  >
                    Deactivate
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start text-destructive hover:text-destructive"
                  onClick={() => {
                    setOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        triggerAriaLabel={`Delete eligibility rule ${label}`}
        title="Delete eligibility rule"
        description={
          <>
            Remove the <span className="font-medium text-foreground">{label}</span> rule? This is a soft delete --
            the rule stays visible (as Inactive) and can be reactivated later.
          </>
        }
        onDelete={() => deleteEligibilityRule(rule.id)}
        onDeleted={onDeleted}
      />
    </>
  );
}

export function EligibilityRulesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const keyword = useFieldValidation("", required("Required qualification keyword is required"));
  const [formError, setFormError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewingRule, setViewingRule] = useState<EligibilityRule | null>(null);

  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<EligibilityRuleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<EligibilityRuleSortDirection>("desc");

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  const [authorityFilter, setAuthorityFilter] = useState<RegulatoryAuthority | "ALL">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<StaffRoleCategory | "ALL">("ALL");
  const [departmentFilter, setDepartmentFilter] = useState<string>("ALL");
  // Committed on blur/Enter (server-side filters), same convention as `search`
  // below and as DepartmentsPage's own search box -- this is now server-
  // filtered, not client-filtered, so committing per keystroke would fire a
  // request per key.
  const [positionInput, setPositionInput] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  // Maps to the `status` filter (DRAFT/ACTIVE/ARCHIVED), NOT `is_active` --
  // deliberately not conflated (see EligibilityRuleDetailDrawer's own
  // Workflow section, which shows both distinctly). There's no separate
  // is_active filter control in this bar: `is_active` stays visible per-row
  // as its own badge in the Status column instead of being silently hidden
  // by a default filter a user might not know to look for -- unlike
  // Departments/Users, a rule's inactive state here is reached via the
  // explicit "Deactivate" row action, and hiding it by default would make
  // that action look like a silent delete with no visible way back short of
  // guessing there's a hidden toggle.
  const [statusFilter, setStatusFilter] = useState<EligibilityRuleStatus | "ALL">("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: [
      "eligibility-rules",
      limit,
      offset,
      sortBy,
      sortDir,
      campusFilter,
      authorityFilter,
      categoryFilter,
      departmentFilter,
      positionFilter,
      statusFilter,
      search,
    ],
    queryFn: () =>
      listEligibilityRules({
        limit,
        offset,
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_id: campusFilter === "ALL" ? null : campusFilter,
        regulatory_authority: authorityFilter === "ALL" ? null : authorityFilter,
        staff_category: categoryFilter === "ALL" ? null : categoryFilter,
        department_id: departmentFilter === "ALL" ? null : departmentFilter,
        position_title: positionFilter.trim() || null,
        status: statusFilter === "ALL" ? null : statusFilter,
        search: search.trim() || null,
      }),
  });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const canManage = Boolean(user && ELIGIBILITY_RULE_MANAGEMENT_ROLES.includes(user.role));

  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));
  const departmentById = new Map((departments ?? []).map((d) => [d.id, d]));

  const rules = data?.items ?? [];
  const total = data?.total ?? 0;

  const filtersActive =
    campusFilter !== "ALL" ||
    authorityFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    positionFilter.trim() !== "" ||
    statusFilter !== "ALL" ||
    search.trim() !== "";

  function clearFilters() {
    setCampusFilter("ALL");
    setAuthorityFilter("ALL");
    setCategoryFilter("ALL");
    setDepartmentFilter("ALL");
    setPositionInput("");
    setPositionFilter("");
    setStatusFilter("ALL");
    setSearchInput("");
    setSearch("");
    setOffset(0);
  }

  function commitPosition() {
    setPositionFilter(positionInput);
    setOffset(0);
  }

  function commitSearch() {
    setSearch(searchInput);
    setOffset(0);
  }

  function handleSort(column: ColumnDef) {
    if (!column.sortBy) return;
    if (sortBy === column.sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column.sortBy);
      setSortDir("asc");
    }
    setOffset(0);
  }

  const exportMutation = useMutation({
    mutationFn: () =>
      exportEligibilityRules({
        sort_by: sortBy,
        sort_dir: sortDir,
        campus_id: campusFilter === "ALL" ? null : campusFilter,
        regulatory_authority: authorityFilter === "ALL" ? null : authorityFilter,
        staff_category: categoryFilter === "ALL" ? null : categoryFilter,
        department_id: departmentFilter === "ALL" ? null : departmentFilter,
        position_title: positionFilter.trim() || null,
        status: statusFilter === "ALL" ? null : statusFilter,
        search: search.trim() || null,
      }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Export failed"),
  });

  function afterSave() {
    setFormError(null);
    setDialogOpen(false);
    setEditingRuleId(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] });
  }

  function buildPayload() {
    return {
      campus_id: form.campusId,
      department_id: form.departmentId || null,
      staff_category: form.staffCategory,
      position_title: form.positionTitle.trim() || null,
      required_qualification_keyword: keyword.value,
      net_set_required: triStateToBool(form.netSetRequired),
      subject: form.subject.trim() || null,
      skills_keyword: form.skillsKeyword.trim() || null,
      id_proof_required: triStateToBool(form.idProofRequired),
      shift_preference: form.shiftPreference.trim() || null,
      regulatory_authority: form.regulatoryAuthority || null,
      school_or_college: form.schoolOrCollege.trim() || null,
      programme_discipline: form.programmeDiscipline.trim() || null,
      minimum_qualification: form.minimumQualification.trim() || null,
      minimum_percentage: form.minimumPercentage.trim() || null,
      required_experience: form.requiredExperience.trim() || null,
      required_credential: form.requiredCredential.trim() || null,
      required_keywords: form.requiredKeywords.trim() || null,
      preferred_keywords: form.preferredKeywords.trim() || null,
      phd_required: triStateToBool(form.phdRequired),
      professional_registration: form.professionalRegistration.trim() || null,
      industry_experience: form.industryExperience.trim() || null,
      priority: form.priority.trim() || null,
      effective_from: form.effectiveFrom || null,
      effective_to: form.effectiveTo || null,
      source_regulation: form.sourceRegulation.trim() || null,
      status: form.status,
      verification_required: form.verificationRequired,
      is_active: form.isActive,
      notes: form.notes.trim() || null,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => createEligibilityRule(buildPayload()),
    onSuccess: () => {
      afterSave();
      toast.success("Eligibility rule created.");
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Failed to create rule"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateEligibilityRule(editingRuleId!, buildPayload()),
    onSuccess: () => {
      afterSave();
      toast.success("Eligibility rule updated.");
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Failed to update rule"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateEligibilityRule(id),
    onSuccess: (newRule) => {
      void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] });
      toast.success("Rule duplicated as a new draft -- now editing the copy.");
      openEditDialog(newRule);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to duplicate rule"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => updateEligibilityRule(id, { is_active: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] });
      toast.success("Rule deactivated.");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to deactivate rule"),
  });

  function openCreateDialog() {
    setEditingRuleId(null);
    setForm(EMPTY_FORM);
    keyword.onChange("");
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(rule: EligibilityRule) {
    setEditingRuleId(rule.id);
    setForm(formStateFromRule(rule));
    keyword.onChange(rule.required_qualification_keyword);
    setFormError(null);
    setDialogOpen(true);
  }

  function openViewDrawer(rule: EligibilityRule) {
    setViewingRule(rule);
    setDrawerOpen(true);
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

  const columnCount = COLUMNS.length + 1; // + Actions, always shown (View is available to every staff role)

  // Department options scoped to the chosen campus, once one is picked --
  // same "narrow the picker once campus is known" convention as
  // SanctionedStrengthDrawer's own location filtering.
  const formDepartmentOptions = form.campusId
    ? (departments ?? []).filter((d) => d.campus_id === form.campusId)
    : (departments ?? []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Eligibility Rules"
        description="Regulatory minimum-qualification rules per campus, department, and staff category."
        actions={
          <>
            {/* Export mirrors export_eligibility_rules's own _staff_only gate
                (broader than ELIGIBILITY_RULE_MANAGEMENT_ROLES/canManage) --
                same reasoning as Departments' own Export button; visible to
                any staff role that can view this page at all. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? "Exporting…" : "Export"}
            </Button>
            {canManage ? (
              <>
                <EligibilityRuleBulkUploadDialog />
                <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Upload history
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Eligibility rule bulk upload history</DialogTitle>
                    </DialogHeader>
                    <UploadHistoryTab entityType="ELIGIBILITY_RULE" />
                  </DialogContent>
                </Dialog>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      New rule
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{editingRuleId ? "Edit eligibility rule" : "New eligibility rule"}</DialogTitle>
                    </DialogHeader>
                    <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Identity
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label>Campus</Label>
                            <Select
                              value={form.campusId}
                              onValueChange={(v) => setForm((f) => ({ ...f, campusId: v, departmentId: "" }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a campus" />
                              </SelectTrigger>
                              <SelectContent>
                                {(campuses ?? []).map((campus) => (
                                  <SelectItem key={campus.id} value={campus.id}>
                                    {campus.code}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Department (optional)</Label>
                            <Select
                              value={form.departmentId || "NONE"}
                              onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v === "NONE" ? "" : v }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Applies broadly" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Applies broadly (no single department)</SelectItem>
                                {formDepartmentOptions.map((department) => (
                                  <SelectItem key={department.id} value={department.id}>
                                    {department.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Staff category</Label>
                            <Select
                              value={form.staffCategory}
                              onValueChange={(v) =>
                                setForm((f) => ({ ...f, staffCategory: v as StaffRoleCategory }))
                              }
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
                              placeholder="Leave blank to apply to all positions"
                              value={form.positionTitle}
                              onChange={(e) => setForm((f) => ({ ...f, positionTitle: e.target.value }))}
                            />
                          </div>
                        </div>
                        {form.staffCategory === "TEACHING" ? (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor="subject">Subject (optional)</Label>
                              <Input
                                id="subject"
                                value={form.subject}
                                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <Label>NET/SLET required (optional)</Label>
                              <Select
                                value={form.netSetRequired}
                                onValueChange={(v) => setForm((f) => ({ ...f, netSetRequired: v as TriState }))}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="UNSET">Not set</SelectItem>
                                  <SelectItem value="TRUE">Yes</SelectItem>
                                  <SelectItem value="FALSE">No</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : null}
                        {form.staffCategory === "NON_TEACHING" ? (
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="skills_keyword">Skills keyword (optional)</Label>
                            <Input
                              id="skills_keyword"
                              value={form.skillsKeyword}
                              onChange={(e) => setForm((f) => ({ ...f, skillsKeyword: e.target.value }))}
                            />
                          </div>
                        ) : null}
                        {form.staffCategory === "HOUSEKEEPING" ? (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                              <Label>ID proof required (optional)</Label>
                              <Select
                                value={form.idProofRequired}
                                onValueChange={(v) => setForm((f) => ({ ...f, idProofRequired: v as TriState }))}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="UNSET">Not set</SelectItem>
                                  <SelectItem value="TRUE">Yes</SelectItem>
                                  <SelectItem value="FALSE">No</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor="shift_preference">Shift preference (optional)</Label>
                              <Input
                                id="shift_preference"
                                value={form.shiftPreference}
                                onChange={(e) => setForm((f) => ({ ...f, shiftPreference: e.target.value }))}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Regulatory
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label>Regulatory authority (optional)</Label>
                            <Select
                              value={form.regulatoryAuthority || "NONE"}
                              onValueChange={(v) =>
                                setForm((f) => ({
                                  ...f,
                                  regulatoryAuthority: v === "NONE" ? "" : (v as RegulatoryAuthority),
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Not set" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Not set</SelectItem>
                                {REGULATORY_AUTHORITIES.map((authority) => (
                                  <SelectItem key={authority} value={authority}>
                                    {REGULATORY_AUTHORITY_LABELS[authority]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="school_or_college">School / College (optional)</Label>
                            <Input
                              id="school_or_college"
                              value={form.schoolOrCollege}
                              onChange={(e) => setForm((f) => ({ ...f, schoolOrCollege: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="programme_discipline">Programme / Discipline (optional)</Label>
                            <Input
                              id="programme_discipline"
                              value={form.programmeDiscipline}
                              onChange={(e) => setForm((f) => ({ ...f, programmeDiscipline: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="source_regulation">Source regulation (optional)</Label>
                          <Textarea
                            id="source_regulation"
                            value={form.sourceRegulation}
                            onChange={(e) => setForm((f) => ({ ...f, sourceRegulation: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Qualification
                        </h3>
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
                          <p className="text-xs text-muted-foreground">
                            The only field the live eligibility check actually evaluates.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="minimum_qualification">Minimum qualification (optional)</Label>
                            <Textarea
                              id="minimum_qualification"
                              value={form.minimumQualification}
                              onChange={(e) => setForm((f) => ({ ...f, minimumQualification: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="minimum_percentage">Minimum percentage (optional)</Label>
                            <Input
                              id="minimum_percentage"
                              value={form.minimumPercentage}
                              onChange={(e) => setForm((f) => ({ ...f, minimumPercentage: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>PhD required (optional)</Label>
                            <Select
                              value={form.phdRequired}
                              onValueChange={(v) => setForm((f) => ({ ...f, phdRequired: v as TriState }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UNSET">Not set</SelectItem>
                                <SelectItem value="TRUE">Yes</SelectItem>
                                <SelectItem value="FALSE">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="required_credential">Required credential (optional)</Label>
                            <Input
                              id="required_credential"
                              value={form.requiredCredential}
                              onChange={(e) => setForm((f) => ({ ...f, requiredCredential: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="professional_registration">Professional registration (optional)</Label>
                            <Input
                              id="professional_registration"
                              value={form.professionalRegistration}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, professionalRegistration: e.target.value }))
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Experience
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="required_experience">Required experience (optional)</Label>
                            <Input
                              id="required_experience"
                              value={form.requiredExperience}
                              onChange={(e) => setForm((f) => ({ ...f, requiredExperience: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="industry_experience">Industry experience (optional)</Label>
                            <Input
                              id="industry_experience"
                              value={form.industryExperience}
                              onChange={(e) => setForm((f) => ({ ...f, industryExperience: e.target.value }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Keywords
                        </h3>
                        <p className="rounded-md border border-brand-warning/30 bg-brand-warning/10 px-3 py-2 text-xs text-brand-warning">
                          Informational only -- these are never consulted by the live eligibility check, only the
                          Required qualification keyword field above is.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="required_keywords">Required keywords (optional)</Label>
                            <Textarea
                              id="required_keywords"
                              value={form.requiredKeywords}
                              onChange={(e) => setForm((f) => ({ ...f, requiredKeywords: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="preferred_keywords">Preferred keywords (optional)</Label>
                            <Textarea
                              id="preferred_keywords"
                              value={form.preferredKeywords}
                              onChange={(e) => setForm((f) => ({ ...f, preferredKeywords: e.target.value }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Workflow
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1.5">
                            <Label>Status</Label>
                            <Select
                              value={form.status}
                              onValueChange={(v) => setForm((f) => ({ ...f, status: v as EligibilityRuleStatus }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ELIGIBILITY_RULE_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {ELIGIBILITY_RULE_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
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
                            <Label>Verification required</Label>
                            <Select
                              value={form.verificationRequired ? "true" : "false"}
                              onValueChange={(v) =>
                                setForm((f) => ({ ...f, verificationRequired: v === "true" }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="priority">Priority (optional)</Label>
                            <Input
                              id="priority"
                              value={form.priority}
                              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="effective_from">Effective from (optional)</Label>
                            <Input
                              id="effective_from"
                              type="date"
                              value={form.effectiveFrom}
                              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="effective_to">Effective to (optional)</Label>
                            <Input
                              id="effective_to"
                              type="date"
                              value={form.effectiveTo}
                              onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="notes">Notes (optional)</Label>
                          <Textarea
                            id="notes"
                            value={form.notes}
                            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                    <DialogFooter>
                      <Button disabled={!form.campusId || !keyword.value.trim() || isSaving} onClick={submit}>
                        {isSaving ? "Saving…" : editingRuleId ? "Save changes" : "Create rule"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={authorityFilter}
          onValueChange={(v) => {
            setAuthorityFilter(v as RegulatoryAuthority | "ALL");
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Regulatory authority filter" className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All authorities</SelectItem>
            {REGULATORY_AUTHORITIES.map((authority) => (
              <SelectItem key={authority} value={authority}>
                {REGULATORY_AUTHORITY_LABELS[authority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={campusFilter}
          onValueChange={(v) => {
            setCampusFilter(v);
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Campus filter" className="sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All campuses</SelectItem>
            {(campuses ?? []).map((campus) => (
              <SelectItem key={campus.id} value={campus.id}>
                {campus.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* No dedicated "School" filter: school_or_college is free text on the
            rule itself, not a real campus/department lookup table this app
            has anywhere -- inventing one would be a fake master-data list.
            It's reachable instead via the Search box below (which already
            matches school_or_college server-side, along with position_title/
            programme_discipline/notes). */}
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v as StaffRoleCategory | "ALL");
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Category filter" className="sm:w-44">
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
        <Select
          value={departmentFilter}
          onValueChange={(v) => {
            setDepartmentFilter(v);
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Department filter" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All departments</SelectItem>
            {(departments ?? []).map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={positionInput}
          onChange={(e) => setPositionInput(e.target.value)}
          onBlur={commitPosition}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitPosition();
          }}
          placeholder="Position"
          aria-label="Position filter"
          className="sm:w-40"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as EligibilityRuleStatus | "ALL");
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label="Status filter" className="sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {ELIGIBILITY_RULE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {ELIGIBILITY_RULE_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSearch();
          }}
          placeholder="Search position, school, or notes"
          aria-label="Search eligibility rules"
          className="sm:w-64"
        />
        <div className="ml-auto flex items-center gap-2">
          {filtersActive ? <span className="text-xs text-muted-foreground">Filters applied</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!filtersActive}
            onClick={clearFilters}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      </div>

      {/* UI redesign Phase 3 -- one Card boundary shared by the loading/
          empty/table states, not just the loaded table. */}
      <Card>
        <CardContent className="p-0">
          {/* Deliberately NOT the `Table` wrapper component -- its own
              `overflow-x-auto` div breaks `position: sticky` headers, see
              DepartmentsPage's own comment on this exact root-cause finding
              (commit ce3dad6 and after). */}
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                {COLUMNS.map((column) =>
                  column.sortBy ? (
                    <TableHead
                      key={column.key}
                      sorted={sortBy === column.sortBy ? sortDir : false}
                      onSort={() => handleSort(column)}
                    >
                      {column.label}
                    </TableHead>
                  ) : (
                    <TableHead key={column.key}>{column.label}</TableHead>
                  ),
                )}
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={columnCount} loading />
              ) : isError ? (
                <TableEmpty colSpan={columnCount} className="text-destructive">
                  {loadError instanceof ApiError ? loadError.message : "Failed to load eligibility rules."}
                </TableEmpty>
              ) : rules.length === 0 ? (
                <TableEmpty colSpan={columnCount}>
                  <div className="flex flex-col items-center gap-2 py-2">
                    <p>
                      {filtersActive
                        ? "No eligibility rules match the current filters."
                        : "No eligibility rules found."}
                    </p>
                    {filtersActive ? (
                      <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : canManage ? (
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" onClick={openCreateDialog}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          New rule
                        </Button>
                        <EligibilityRuleBulkUploadDialog />
                      </div>
                    ) : null}
                  </div>
                </TableEmpty>
              ) : (
                rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-mono text-xs">{campusById.get(rule.campus_id)?.code ?? "—"}</TableCell>
                    <TableCell>
                      {rule.regulatory_authority ? REGULATORY_AUTHORITY_LABELS[rule.regulatory_authority] : "—"}
                    </TableCell>
                    <TableCell>{rule.school_or_college ?? "—"}</TableCell>
                    <TableCell>{rule.staff_category.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      {rule.department_id ? (departmentById.get(rule.department_id)?.name ?? "—") : "—"}
                    </TableCell>
                    <TableCell>{rule.position_title ?? "All positions"}</TableCell>
                    <TableCell>{rule.required_qualification_keyword}</TableCell>
                    <TableCell>{rule.required_experience ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline">{ELIGIBILITY_RULE_STATUS_LABELS[rule.status]}</Badge>
                        <Badge variant={rule.is_active ? "success" : "destructive"}>
                          {rule.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <EligibilityRuleRowActions
                        rule={rule}
                        canManage={canManage}
                        onView={() => openViewDrawer(rule)}
                        onEdit={() => openEditDialog(rule)}
                        onDuplicate={() => duplicateMutation.mutate(rule.id)}
                        onDeactivate={() => deactivateMutation.mutate(rule.id)}
                        onDeleted={() => void queryClient.invalidateQueries({ queryKey: ["eligibility-rules"] })}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </CardContent>
      </Card>

      <Pagination
        total={total}
        limit={limit}
        offset={offset}
        onOffsetChange={setOffset}
        onLimitChange={(nextLimit) => {
          setLimit(nextLimit);
          setOffset(0);
        }}
        itemLabel="eligibility rules"
      />

      <EligibilityRuleDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        rule={viewingRule}
        campusLabel={viewingRule ? (campusById.get(viewingRule.campus_id)?.code ?? "—") : "—"}
        departmentLabel={
          viewingRule?.department_id
            ? (departmentById.get(viewingRule.department_id)?.name ?? "—")
            : "Applies broadly"
        }
      />
    </div>
  );
}
