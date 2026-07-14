import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listEmployees } from "@/api/employees";
import {
  completeOnboarding,
  createEmployee,
  getJoiningRecord,
  listJoiningDocuments,
  markJoined,
  updateJoiningDocument,
} from "@/api/joining";
import type { ApplicationRead, JoiningDocumentStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const READ_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN"];
const HR_ONLY_ROLES = ["HR_ADMIN", "SUPER_ADMIN"];

export function JoiningCard({ application }: { application: ApplicationRead }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [designation, setDesignation] = useState("");

  const canRead = Boolean(user && READ_ROLES.includes(user.role));
  const canWrite = Boolean(user && HR_ONLY_ROLES.includes(user.role));

  const { data: record } = useQuery({
    queryKey: ["joining-record", application.id],
    queryFn: () => getJoiningRecord(application.id),
    enabled: canRead,
  });

  const { data: documents } = useQuery({
    queryKey: ["joining-documents", application.id],
    queryFn: () => listJoiningDocuments(application.id),
    enabled: canRead,
  });

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: listEmployees,
    enabled: canRead && application.status === "EMPLOYEE_CREATED",
  });
  const employee = employees?.find((e) => e.application_id === application.id);

  function afterAction() {
    void queryClient.invalidateQueries({ queryKey: ["joining-record", application.id] });
    void queryClient.invalidateQueries({ queryKey: ["joining-documents", application.id] });
    void queryClient.invalidateQueries({ queryKey: ["application", application.id] });
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
    void queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  const toggleDocumentMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JoiningDocumentStatus }) =>
      updateJoiningDocument(id, { status }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Update failed"),
  });

  const markJoinedMutation = useMutation({
    mutationFn: () => markJoined(application.id),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Mark joined failed"),
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: () => completeOnboarding(application.id),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Complete onboarding failed"),
  });

  const createEmployeeMutation = useMutation({
    mutationFn: () => createEmployee(application.id, { designation: designation || null }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Create employee failed"),
  });

  if (!canRead) {
    return null;
  }

  const hasPendingDocuments = documents?.some((d) => d.status === "PENDING") ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Joining</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {record ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Expected joining date</div>
              <div>{new Date(record.joining_date).toLocaleDateString()}</div>
            </div>
            {record.actual_joining_date ? (
              <div>
                <div className="text-muted-foreground">Actual joining date</div>
                <div>{new Date(record.actual_joining_date).toLocaleDateString()}</div>
              </div>
            ) : null}
            {record.onboarding_completed_at ? (
              <div>
                <div className="text-muted-foreground">Onboarding completed</div>
                <div>{new Date(record.onboarding_completed_at).toLocaleString()}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {documents && documents.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{doc.document_type.replace(/_/g, " ")}</span>
                  <Badge variant={doc.status === "RECEIVED" ? "success" : "outline"} className="ml-2">
                    {doc.status}
                  </Badge>
                </div>
                {canWrite ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={toggleDocumentMutation.isPending}
                    onClick={() =>
                      toggleDocumentMutation.mutate({
                        id: doc.id,
                        status: doc.status === "RECEIVED" ? "PENDING" : "RECEIVED",
                      })
                    }
                  >
                    {doc.status === "RECEIVED" ? "Mark pending" : "Mark received"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {application.status === "JOINING_PENDING" ? (
          <Button
            className="w-fit"
            disabled={markJoinedMutation.isPending}
            onClick={() => markJoinedMutation.mutate()}
          >
            {markJoinedMutation.isPending ? "Marking…" : "Mark joined"}
          </Button>
        ) : null}

        {application.status === "JOINED" && canWrite ? (
          <div className="flex flex-col gap-1.5">
            <Button
              className="w-fit"
              disabled={completeOnboardingMutation.isPending || hasPendingDocuments}
              onClick={() => completeOnboardingMutation.mutate()}
            >
              {completeOnboardingMutation.isPending ? "Completing…" : "Complete onboarding"}
            </Button>
            {hasPendingDocuments ? (
              <p className="text-xs text-muted-foreground">All documents must be received first.</p>
            ) : null}
          </div>
        ) : null}

        {application.status === "ONBOARDING_COMPLETE" && canWrite ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="designation">Designation (optional)</Label>
            <Input
              id="designation"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className="max-w-xs"
            />
            <Button
              className="w-fit"
              disabled={createEmployeeMutation.isPending}
              onClick={() => createEmployeeMutation.mutate()}
            >
              {createEmployeeMutation.isPending ? "Creating…" : "Create employee"}
            </Button>
          </div>
        ) : null}

        {application.status === "EMPLOYEE_CREATED" && employee ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Employee code</div>
              <div>{employee.employee_code}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Designation</div>
              <div>{employee.designation}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Date of joining</div>
              <div>{new Date(employee.date_of_joining).toLocaleDateString()}</div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
