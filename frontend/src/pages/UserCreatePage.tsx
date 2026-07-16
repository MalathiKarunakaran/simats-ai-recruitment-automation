import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { ASSIGNABLE_STAFF_ROLES, SINGLE_CAMPUS_SCOPE_ROLES, USER_MANAGEMENT_ROLES, type UserRole } from "@/api/types";
import { createUser } from "@/api/users";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function UserCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: listDepartments });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("RECRUITMENT_OFFICER");
  const [campusId, setCampusId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const requiresCampus = SINGLE_CAMPUS_SCOPE_ROLES.includes(role);
  const departmentOptions = (departments ?? []).filter((d) => d.campus_id === campusId);

  const mutation = useMutation({
    mutationFn: () =>
      createUser({
        email,
        password,
        full_name: fullName,
        role,
        campus_id: campusId || null,
        department_id: departmentId || null,
        phone_number: phoneNumber || null,
      }),
    onSuccess: () => navigate("/users"),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  if (!user || !USER_MANAGEMENT_ROLES.includes(user.role)) {
    return (
      <p className="text-sm text-muted-foreground">Only a Super Admin or HR Admin can create new users.</p>
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  function handleRoleChange(value: string) {
    const nextRole = value as UserRole;
    setRole(nextRole);
    if (!SINGLE_CAMPUS_SCOPE_ROLES.includes(nextRole)) {
      setCampusId("");
      setDepartmentId("");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">New user</h1>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={handleRoleChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_STAFF_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campus {requiresCampus ? "" : "(optional)"}</Label>
          <Select
            value={campusId}
            onValueChange={(value) => {
              setCampusId(value);
              setDepartmentId("");
            }}
          >
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
          <Label>Department (optional)</Label>
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone_number">Phone number (optional)</Label>
          <Input id="phone_number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={mutation.isPending || (requiresCampus && !campusId)}>
          {mutation.isPending ? "Creating…" : "Create user"}
        </Button>
      </form>
    </div>
  );
}
