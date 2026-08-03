import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { listEmployees } from "@/api/employees";
import {
  allotDepartmentRoom,
  completeOrientation,
  getJoiningRecord,
  handOverToHod,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const READ_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];
const HR_ONLY_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];

export function JoiningCard({ application }: { application: ApplicationRead }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [roomAllotted, setRoomAllotted] = useState("");
  const [orientationDate, setOrientationDate] = useState("");
  const [hodAssigned, setHodAssigned] = useState("");
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

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: listDepartments,
    enabled: canWrite && application.status === "JOINED",
  });
  const departmentOptions = (departments ?? []).filter((d) => d.campus_id === application.campus_id);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: listEmployees,
    enabled: canRead && application.status === "HANDED_OVER_TO_HOD",
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

  const allotDepartmentRoomMutation = useMutation({
    mutationFn: () =>
      allotDepartmentRoom(application.id, { department_id: departmentId, room_allotted: roomAllotted || null }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Department/room allotment failed"),
  });

  const completeOrientationMutation = useMutation({
    mutationFn: () => completeOrientation(application.id, { orientation_date: orientationDate || null }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Complete orientation failed"),
  });

  const handOverToHodMutation = useMutation({
    mutationFn: () =>
      handOverToHod(application.id, { hod_assigned: hodAssigned, designation: designation || null }),
    onSuccess: () => {
      setError(null);
      afterAction();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Handover to HOD failed"),
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

        {application.status === "JOINING_CONFIRMED" ? (
          <Button
            className="w-fit"
            disabled={markJoinedMutation.isPending}
            onClick={() => markJoinedMutation.mutate()}
          >
            {markJoinedMutation.isPending ? "Marking…" : "Mark joined"}
          </Button>
        ) : null}

        {application.status === "JOINED" && canWrite ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a department" />
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
                <Label htmlFor="room_allotted">Room (optional)</Label>
                <Input id="room_allotted" value={roomAllotted} onChange={(e) => setRoomAllotted(e.target.value)} />
              </div>
            </div>
            <Button
              className="w-fit"
              disabled={allotDepartmentRoomMutation.isPending || hasPendingDocuments || !departmentId}
              onClick={() => allotDepartmentRoomMutation.mutate()}
            >
              {allotDepartmentRoomMutation.isPending ? "Confirming…" : "Confirm department & room allotment"}
            </Button>
            {hasPendingDocuments ? (
              <p className="text-xs text-muted-foreground">All documents must be received first.</p>
            ) : null}
          </div>
        ) : null}

        {application.status === "DEPARTMENT_ROOM_ALLOTTED" && canWrite ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="orientation_date">Orientation date</Label>
            <Input
              id="orientation_date"
              type="date"
              value={orientationDate}
              onChange={(e) => setOrientationDate(e.target.value)}
              className="max-w-xs"
            />
            <Button
              className="w-fit"
              disabled={completeOrientationMutation.isPending}
              onClick={() => completeOrientationMutation.mutate()}
            >
              {completeOrientationMutation.isPending ? "Completing…" : "Mark orientation complete"}
            </Button>
          </div>
        ) : null}

        {application.status === "ORIENTATION_COMPLETE" && canWrite ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hod_assigned">HOD assigned</Label>
              <Input
                id="hod_assigned"
                required
                value={hodAssigned}
                onChange={(e) => setHodAssigned(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="designation">Designation (optional)</Label>
              <Input
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <Button
              className="w-fit"
              disabled={handOverToHodMutation.isPending || !hodAssigned.trim()}
              onClick={() => handOverToHodMutation.mutate()}
            >
              {handOverToHodMutation.isPending ? "Handing over…" : "Hand over to HOD"}
            </Button>
          </div>
        ) : null}

        {application.status === "HANDED_OVER_TO_HOD" ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Room allotted</div>
              <div>{application.room_allotted ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Orientation date</div>
              <div>{application.orientation_date ? new Date(application.orientation_date).toLocaleDateString() : "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">HOD assigned</div>
              <div>{application.hod_assigned ?? "—"}</div>
            </div>
            {employee ? (
              <>
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
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
