import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listDepartments } from "@/api/departments";
import { listEmployees } from "@/api/employees";
import { listLocations } from "@/api/locations";
import {
  allotDepartmentRoom,
  completeOrientation,
  getJoiningRecord,
  handOverToHod,
  listJoiningDocuments,
  markJoined,
  updateJoiningDocument,
} from "@/api/joining";
import type { ApplicationRead, HousekeepingShift, JoiningDocumentStatus } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { locationLabel } from "@/lib/locationDisplay";

const READ_ROLES = ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];
const HR_ONLY_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"];

const SHIFT_OPTIONS: { value: HousekeepingShift; label: string }[] = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "NIGHT", label: "Night" },
];

export function JoiningCard({ application }: { application: ApplicationRead }) {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [roomAllotted, setRoomAllotted] = useState("");
  const [orientationDate, setOrientationDate] = useState("");
  const [hodAssigned, setHodAssigned] = useState("");
  const [designation, setDesignation] = useState("");
  // Housekeeping only: joining.py puts the hire on the housekeeping roster
  // at hand-over, which is what that category's working count is counted
  // from. Nothing earlier in the pipeline collects these.
  const isHousekeeping = application.role_category === "HOUSEKEEPING";
  const [bioId, setBioId] = useState("");
  const [shift, setShift] = useState<HousekeepingShift | "">("");
  const [locationId, setLocationId] = useState("");
  const [supervisor, setSupervisor] = useState("");

  // Bug fix: both OR'd with hasPermission("ONBOARDING") -- every joining.py
  // endpoint (reads and writes alike) is gated by the same
  // require_permission(ONBOARDING), not either role list alone, so someone
  // individually granted it outside READ_ROLES/HR_ONLY_ROLES must still see
  // (and be able to act on) this card, same pattern as UsersListPage's
  // canManage.
  const hasOnboardingPermission = hasPermission?.("ONBOARDING") ?? false;
  const canRead = Boolean(user && (READ_ROLES.includes(user.role) || hasOnboardingPermission));
  const canWrite = Boolean(user && (HR_ONLY_ROLES.includes(user.role) || hasOnboardingPermission));

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

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: listLocations,
    enabled: canWrite && isHousekeeping && application.status === "ORIENTATION_COMPLETE",
  });
  const locationOptions = (locations ?? []).filter((l) => l.campus_id === application.campus_id && l.is_active);

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
      handOverToHod(application.id, {
        hod_assigned: hodAssigned,
        designation: designation || null,
        ...(isHousekeeping
          ? {
              bio_id: bioId.trim(),
              shift: shift || null,
              location_id: locationId || null,
              supervisor: supervisor.trim() || null,
            }
          : {}),
      }),
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
            {isHousekeeping ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Housekeeping: this hand-over also adds the person to the housekeeping roster, which is what
                  the Housekeeping working strength counts.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="bio_id">Bio ID</Label>
                    <Input id="bio_id" required value={bioId} onChange={(e) => setBioId(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="shift">Shift</Label>
                    <Select value={shift} onValueChange={(value) => setShift(value as HousekeepingShift)}>
                      <SelectTrigger id="shift" aria-label="Shift">
                        <SelectValue placeholder="Select a shift" />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIFT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="roster_location">Location</Label>
                    <Select value={locationId} onValueChange={setLocationId}>
                      <SelectTrigger id="roster_location" aria-label="Location">
                        <SelectValue placeholder="Select a location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locationOptions.map((location) => (
                          <SelectItem key={location.id} value={location.id}>
                            {locationLabel(location)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="supervisor">Supervisor (optional)</Label>
                    <Input id="supervisor" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : null}
            <Button
              className="w-fit"
              disabled={
                handOverToHodMutation.isPending ||
                !hodAssigned.trim() ||
                (isHousekeeping && (!bioId.trim() || !shift || !locationId))
              }
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
