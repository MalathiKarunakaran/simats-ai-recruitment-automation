import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import { listDesignations } from "@/api/designations";
import type {
  DesignationRead,
  EmploymentType,
  StaffRoleCategory,
  VacancyPriority,
  VacancyRequestCreatePayload,
  VacancyRequestRead,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createVacancyRequest } from "@/api/vacancyRequests";

const ROLE_CATEGORIES: { value: StaffRoleCategory; label: string; hint: string }[] = [
  { value: "TEACHING", label: "Teaching", hint: "Faculty / academic positions" },
  { value: "NON_TEACHING", label: "Non-Teaching", hint: "Administrative / support staff" },
  { value: "HOUSEKEEPING", label: "Housekeeping", hint: "Facilities / housekeeping staff" },
];
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT", "TRA", "JRF"];
const PRIORITIES: VacancyPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

const STEP_TITLES = [
  "Teaching / Non-Teaching",
  "Department",
  "Designation",
  "Required Count",
  "Employment Type",
  "Priority",
  "Remarks & Submit",
];

interface Props {
  onSuccess: (result: VacancyRequestRead) => void;
}

// Replaces the old free-text VacancyRequestForm for *create* (VacancyRequestForm
// itself is kept, unchanged, for editing a DRAFT -- see VacancyRequestEditPage).
// A step-by-step wizard driving the requester through the real Department ->
// Designation master-data linkage, per the Department/Designation Master
// rollout spec: role_category -> department -> designation -> count ->
// employment type -> priority -> remarks/submit. No new routing/form
// library -- just a numeric currentStep + conditional rendering, matching
// this codebase's existing no-form-library convention.
export function VacancyRequestWizard({ onSuccess }: Props) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  // A CAMPUS_HOD with their own department_id set may only raise requests
  // for that department (app/api/v1/routers/vacancy_requests.py 403s
  // otherwise) -- lock Step 2 to it rather than letting them pick.
  const lockedDepartmentId = !isSuperAdmin ? (user?.department_id ?? null) : null;

  const [currentStep, setCurrentStep] = useState(0);
  const [roleCategory, setRoleCategory] = useState<StaffRoleCategory | null>(null);
  const [campusId, setCampusId] = useState(isSuperAdmin ? "" : (user?.campus_id ?? ""));
  const [departmentId, setDepartmentId] = useState(lockedDepartmentId ?? "");
  const [designationId, setDesignationId] = useState<string | null>(null);
  const [manualPositionTitle, setManualPositionTitle] = useState("");
  const [manualQualification, setManualQualification] = useState("");
  const [manualExperience, setManualExperience] = useState("");
  const [requestedCount, setRequestedCount] = useState("1");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("FULL_TIME");
  const [priority, setPriority] = useState<VacancyPriority>("NORMAL");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });
  const { data: designations, isLoading: designationsLoading } = useQuery({
    queryKey: ["designations", departmentId, roleCategory],
    queryFn: () => listDesignations({ departmentId, category: roleCategory ?? undefined, isActive: true }),
    enabled: Boolean(departmentId && roleCategory),
  });

  const departmentOptions = (departments ?? []).filter(
    (d) => d.campus_id === campusId && (!d.category || d.category === roleCategory),
  );
  const selectedDesignation = designations?.find((d) => d.id === designationId) ?? null;
  const hasDesignationOptions = (designations ?? []).length > 0;

  const mutation = useMutation({
    mutationFn: () => {
      const positionTitle = selectedDesignation ? selectedDesignation.name : manualPositionTitle;
      const qualification = selectedDesignation ? selectedDesignation.qualification : manualQualification;
      const experienceRequired = selectedDesignation ? selectedDesignation.min_experience : manualExperience;
      const payload: VacancyRequestCreatePayload = {
        campus_id: campusId,
        department_id: departmentId,
        designation_id: designationId,
        role_category: roleCategory!,
        position_title: positionTitle,
        employment_type: employmentType,
        requested_count: Number(requestedCount),
        qualification,
        experience_required: experienceRequired,
        priority,
        remarks: remarks.trim() || null,
      };
      return createVacancyRequest(payload);
    },
    onSuccess,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  function selectDesignation(designation: DesignationRead) {
    setDesignationId(designation.id);
    setEmploymentType(designation.employment_type);
  }

  const stepValid: boolean[] = [
    roleCategory !== null,
    Boolean(campusId && departmentId),
    designationId !== null ||
      (!designationsLoading &&
        !hasDesignationOptions &&
        manualPositionTitle.trim() !== "" &&
        manualQualification.trim() !== "" &&
        manualExperience.trim() !== ""),
    Number(requestedCount) > 0,
    Boolean(employmentType),
    Boolean(priority),
    true,
  ];

  function goNext() {
    if (!stepValid[currentStep]) return;
    setCurrentStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  }
  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {STEP_TITLES.map((title, index) => (
          <li
            key={title}
            className={
              index === currentStep
                ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
                : index < currentStep
                  ? "rounded-full bg-brand-success/15 px-3 py-1 text-brand-success"
                  : "rounded-full bg-muted px-3 py-1"
            }
          >
            {index + 1}. {title}
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {currentStep === 0 ? (
          <div className="flex flex-col gap-3">
            <Label>What kind of position is this?</Label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {ROLE_CATEGORIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setRoleCategory(option.value);
                    setDesignationId(null);
                  }}
                  className={
                    "flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors " +
                    (roleCategory === option.value
                      ? "border-primary bg-brand-primary-light"
                      : "border-border hover:border-primary/40")
                  }
                >
                  <span className="font-medium text-foreground">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {currentStep === 1 ? (
          <div className="flex flex-col gap-4">
            {isSuperAdmin ? (
              <div className="flex flex-col gap-1.5">
                <Label>Campus</Label>
                <Select
                  value={campusId}
                  onValueChange={(v) => {
                    setCampusId(v);
                    setDepartmentId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a campus" />
                  </SelectTrigger>
                  <SelectContent>
                    {campuses?.filter((campus) => campus.is_active).map((campus) => (
                      <SelectItem key={campus.id} value={campus.id}>
                        {campus.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>Campus</Label>
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  {campuses?.find((c) => c.id === campusId)?.code ?? "—"}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
              {lockedDepartmentId ? (
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  {departments?.find((d) => d.id === lockedDepartmentId)?.name ?? "—"}
                </p>
              ) : (
                <Select
                  value={departmentId}
                  onValueChange={(v) => {
                    setDepartmentId(v);
                    setDesignationId(null);
                  }}
                  disabled={!campusId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={campusId ? "Select a department" : "Select a campus first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentOptions.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        ) : null}

        {currentStep === 2 ? (
          <div className="flex flex-col gap-3">
            <Label>Designation</Label>
            {designationsLoading ? (
              <p className="text-sm text-muted-foreground">Loading designations…</p>
            ) : hasDesignationOptions ? (
              <div className="flex flex-col gap-2">
                {designations!.map((designation) => (
                  <button
                    key={designation.id}
                    type="button"
                    onClick={() => selectDesignation(designation)}
                    className={
                      "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors " +
                      (designationId === designation.id
                        ? "border-primary bg-brand-primary-light"
                        : "border-border hover:border-primary/40")
                    }
                  >
                    <span className="font-medium text-foreground">{designation.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {designation.qualification} · {designation.min_experience} ·{" "}
                      {designation.employment_type.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  No designations in the Designation Master match this department and category yet. Enter the
                  position details manually below (an HR Admin or Super Admin can add it to the Designation Master
                  later).
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="manual_position_title">Position title</Label>
                  <Input
                    id="manual_position_title"
                    value={manualPositionTitle}
                    onChange={(e) => setManualPositionTitle(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="manual_qualification">Qualification</Label>
                  <Input
                    id="manual_qualification"
                    value={manualQualification}
                    onChange={(e) => setManualQualification(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="manual_experience">Experience required</Label>
                  <Input
                    id="manual_experience"
                    value={manualExperience}
                    onChange={(e) => setManualExperience(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requested_count">Required count</Label>
            <Input
              id="requested_count"
              type="number"
              min={1}
              value={requestedCount}
              onChange={(e) => setRequestedCount(e.target.value)}
            />
          </div>
        ) : null}

        {currentStep === 4 ? (
          <div className="flex flex-col gap-1.5">
            <Label>Employment type</Label>
            <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as EmploymentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDesignation ? (
              <p className="text-xs text-muted-foreground">
                Pre-filled from {selectedDesignation.name}'s Designation Master entry -- still editable.
              </p>
            ) : null}
          </div>
        ) : null}

        {currentStep === 5 ? (
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as VacancyPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {currentStep === 6 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remarks">Remarks (optional)</Label>
              <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{roleCategory?.replace(/_/g, " ")}</dd>
              <dt className="text-muted-foreground">Department</dt>
              <dd>{departments?.find((d) => d.id === departmentId)?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Designation</dt>
              <dd>{selectedDesignation ? selectedDesignation.name : manualPositionTitle || "—"}</dd>
              <dt className="text-muted-foreground">Required count</dt>
              <dd>{requestedCount}</dd>
              <dt className="text-muted-foreground">Employment type</dt>
              <dd>{employmentType.replace(/_/g, " ")}</dd>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>{priority}</dd>
            </dl>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={goBack} disabled={currentStep === 0}>
          Back
        </Button>
        {currentStep < STEP_TITLES.length - 1 ? (
          <Button type="button" onClick={goNext} disabled={!stepValid[currentStep]}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting…" : "Submit vacancy request"}
          </Button>
        )}
      </div>
    </div>
  );
}
