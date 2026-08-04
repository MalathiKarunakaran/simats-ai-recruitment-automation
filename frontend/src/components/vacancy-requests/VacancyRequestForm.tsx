import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { listDepartments } from "@/api/departments";
import type {
  EmploymentType,
  StaffRoleCategory,
  VacancyPriority,
  VacancyRequestCreatePayload,
  VacancyRequestRead,
} from "@/api/types";
import { createVacancyRequest, updateVacancyRequest } from "@/api/vacancyRequests";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const ROLE_CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];
const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING", "ADJUNCT"];
const PRIORITIES: VacancyPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

interface Props {
  mode: "create" | "edit";
  initialValues?: VacancyRequestRead;
  onSuccess: (result: VacancyRequestRead) => void;
}

export function VacancyRequestForm({ mode, initialValues, onSuccess }: Props) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  // campus_id/department_id are immutable after creation (the backend's
  // PATCH schema doesn't even accept them) -- only meaningful to choose in
  // create mode.
  const [campusId, setCampusId] = useState(
    initialValues?.campus_id ?? (isSuperAdmin ? "" : (user?.campus_id ?? "")),
  );
  const [departmentId, setDepartmentId] = useState(initialValues?.department_id ?? "");
  const [roleCategory, setRoleCategory] = useState<StaffRoleCategory>(initialValues?.role_category ?? "TEACHING");
  const positionTitle = useFieldValidation(
    initialValues?.position_title ?? "",
    required("Position title is required"),
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    initialValues?.employment_type ?? "FULL_TIME",
  );
  const [requestedCount, setRequestedCount] = useState(String(initialValues?.requested_count ?? 1));
  const qualification = useFieldValidation(
    initialValues?.qualification ?? "",
    required("Qualification is required"),
  );
  const experienceRequired = useFieldValidation(
    initialValues?.experience_required ?? "",
    required("Experience required is required"),
  );
  const [salaryMin, setSalaryMin] = useState(initialValues?.salary_band_min?.toString() ?? "");
  const [salaryMax, setSalaryMax] = useState(initialValues?.salary_band_max?.toString() ?? "");
  const [skills, setSkills] = useState(initialValues?.skills?.join(", ") ?? "");
  const [priority, setPriority] = useState<VacancyPriority>(initialValues?.priority ?? "NORMAL");
  const [error, setError] = useState<string | null>(null);

  const departmentOptions = (departments ?? []).filter((d) => d.campus_id === campusId);

  const mutation = useMutation({
    mutationFn: async () => {
      const skillsList = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (mode === "create") {
        const payload: VacancyRequestCreatePayload = {
          campus_id: campusId,
          department_id: departmentId,
          role_category: roleCategory,
          position_title: positionTitle.value,
          employment_type: employmentType,
          requested_count: Number(requestedCount),
          qualification: qualification.value,
          experience_required: experienceRequired.value,
          salary_band_min: salaryMin ? Number(salaryMin) : null,
          salary_band_max: salaryMax ? Number(salaryMax) : null,
          skills: skillsList.length ? skillsList : null,
          priority,
        };
        return createVacancyRequest(payload);
      }
      return updateVacancyRequest(initialValues!.id, {
        position_title: positionTitle.value,
        employment_type: employmentType,
        requested_count: Number(requestedCount),
        qualification: qualification.value,
        experience_required: experienceRequired.value,
        salary_band_min: salaryMin ? Number(salaryMin) : null,
        salary_band_max: salaryMax ? Number(salaryMax) : null,
        skills: skillsList.length ? skillsList : null,
        priority,
      });
    },
    onSuccess,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const positionTitleValid = positionTitle.validate();
    const qualificationValid = qualification.validate();
    const experienceRequiredValid = experienceRequired.validate();
    if (!positionTitleValid || !qualificationValid || !experienceRequiredValid) return;
    mutation.mutate();
  }

  const campusReadOnly = mode === "edit" || !isSuperAdmin;
  const campusLabel = campuses?.find((c) => c.id === campusId);
  const departmentLabel = departments?.find((d) => d.id === departmentId);

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Campus</Label>
          {campusReadOnly ? (
            <p className="flex h-9 items-center text-sm text-muted-foreground">
              {campusLabel ? campusLabel.code : "—"}
            </p>
          ) : (
            <Select value={campusId} onValueChange={(value) => { setCampusId(value); setDepartmentId(""); }}>
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
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Department</Label>
          {mode === "edit" ? (
            <p className="flex h-9 items-center text-sm text-muted-foreground">{departmentLabel?.name ?? "—"}</p>
          ) : (
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={!campusId}>
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="position_title">Position title</Label>
        <Input
          id="position_title"
          required
          value={positionTitle.value}
          onChange={(e) => positionTitle.onChange(e.target.value)}
          onBlur={positionTitle.onBlur}
          aria-invalid={Boolean(positionTitle.error)}
        />
        {positionTitle.error ? <p className="text-xs text-destructive">{positionTitle.error}</p> : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Role category</Label>
          <Select value={roleCategory} onValueChange={(v) => setRoleCategory(v as StaffRoleCategory)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_CATEGORIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Employment type</Label>
          <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as EmploymentType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="requested_count">Requested count</Label>
        <Input
          id="requested_count"
          type="number"
          min={1}
          required
          value={requestedCount}
          onChange={(e) => setRequestedCount(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qualification">Qualification</Label>
        <Textarea
          id="qualification"
          required
          value={qualification.value}
          onChange={(e) => qualification.onChange(e.target.value)}
          onBlur={qualification.onBlur}
          aria-invalid={Boolean(qualification.error)}
        />
        {qualification.error ? <p className="text-xs text-destructive">{qualification.error}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="experience_required">Experience required</Label>
        <Input
          id="experience_required"
          required
          value={experienceRequired.value}
          onChange={(e) => experienceRequired.onChange(e.target.value)}
          onBlur={experienceRequired.onBlur}
          aria-invalid={Boolean(experienceRequired.error)}
        />
        {experienceRequired.error ? <p className="text-xs text-destructive">{experienceRequired.error}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="salary_min">Salary band min (optional)</Label>
          <Input id="salary_min" type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="salary_max">Salary band max (optional)</Label>
          <Input id="salary_max" type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skills">Skills (optional, comma-separated)</Label>
        <Input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={mutation.isPending || (mode === "create" && (!campusId || !departmentId))}>
        {mutation.isPending ? "Saving…" : mode === "create" ? "Create vacancy request" : "Save changes"}
      </Button>
    </form>
  );
}
