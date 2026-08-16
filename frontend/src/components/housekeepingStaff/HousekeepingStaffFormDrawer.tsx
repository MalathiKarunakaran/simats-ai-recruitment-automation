import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { listDesignations } from "@/api/designations";
import { createHousekeepingStaff, updateHousekeepingStaff } from "@/api/housekeepingStaff";
import { listLocations } from "@/api/locations";
import type { HousekeepingShift, HousekeepingStaffRead } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

// Reusable add/edit drawer for one HousekeepingStaff record
// (glowing-zooming-hamming.md Phase D). Deliberately controlled from the
// outside (open/onOpenChange/record, no internal trigger button) rather than
// owning its own trigger the way SanctionedStrengthHistoryDrawer used to
// (folded into SanctionedStrengthDrawer.tsx and deleted in Phase H, once
// that was its only remaining usage) -- both HousekeepingStaffListPage's
// "Add staff"/"Edit" buttons need to open the same instance, and (as of
// Phase G) HousekeepingStrengthTable's own per-location "Add staff"/
// roster-row Edit actions reuse this exact same component for inline
// roster add/edit, so it can't assume a single fixed trigger.
//
// Slide-in technique copied verbatim from SanctionedStrengthHistoryDrawer.tsx
// (Dialog/DialogContent + the same className override) -- no new dependency.
//
// designation_id is filtered client-side to StaffRoleCategoryEnum.HOUSEKEEPING
// only (same "Select's contents do the filtering, backend re-checks
// defensively" pattern as AddDesignationRow.tsx); location_id is filtered to
// the selected campus. bio_id uniqueness is NOT re-validated client-side --
// the backend's real 409 ("bio_id '...' is already in use on this campus.")
// is surfaced verbatim via ApiError.message, same convention as
// DeleteConfirmDialog/LocationsPage's own error handling.
//
// Phase G's own extension: `initialLocationId`/`initialCampusId` (see the
// props doc below) -- HousekeepingStrengthTable already knows which
// Location (and its campus) a given row's "Add staff" action targets before
// the drawer even opens, unlike HousekeepingStaffListPage's own "Add staff"
// button (no location known ahead of time). Both are optional and only
// consulted by the seeding effect below when `record` is null (create
// mode); HousekeepingStaffListPage's existing calls (which omit both) are
// unaffected.

const SHIFTS: HousekeepingShift[] = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"];

export interface HousekeepingStaffFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode; null = create mode. */
  record: HousekeepingStaffRead | null;
  /** Global-scope roles (SUPER_ADMIN/HR_ADMIN) may pick any campus in create
   * mode; single-campus roles (RECRUITMENT_OFFICER) are locked to their own,
   * same "isSuperAdmin ? picker : locked" split as LocationsPage's own
   * create dialog. */
  canChooseCampus: boolean;
  /** The campus to default/lock to in create mode -- the current user's own
   * campus_id for a single-campus role. */
  defaultCampusId: string;
  /** Additive (glowing-zooming-hamming.md Phase G): pre-fill create mode to
   * a known location/campus, for HousekeepingStrengthTable's "Add staff to
   * this location" action -- unlike `defaultCampusId` (a role-driven
   * fallback that's always present), these are only supplied by a caller
   * that already knows which location it's adding to, so both stay
   * optional. Only consulted when `record` is null (create mode); ignored
   * in edit mode, where the record's own campus_id/location_id always win.
   * When `initialCampusId` is set, it takes priority over `defaultCampusId`
   * for the seeded campus (a specific known campus is more precise than the
   * role's generic default) -- see the seeding effect below. Optional and
   * additive only: HousekeepingStaffListPage.tsx's existing usage (which
   * doesn't know a location ahead of time) omits both and keeps behaving
   * exactly as before this phase. */
  initialLocationId?: string;
  initialCampusId?: string;
  onSaved: () => void;
}

export function HousekeepingStaffFormDrawer({
  open,
  onOpenChange,
  record,
  canChooseCampus,
  defaultCampusId,
  initialLocationId,
  initialCampusId,
  onSaved,
}: HousekeepingStaffFormDrawerProps) {
  const isEdit = record !== null;

  const bioId = useFieldValidation("", required("Bio ID is required"));
  const name = useFieldValidation("", required("Name is required"));
  const [campusId, setCampusId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [shift, setShift] = useState<HousekeepingShift | "">("");
  const [block, setBlock] = useState("");
  const [floorVenue, setFloorVenue] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form every time the drawer opens (both create and edit) or
  // the target record changes -- controlled externally, so this is the only
  // place initialization can happen.
  useEffect(() => {
    if (!open) return;
    bioId.onChange(record?.bio_id ?? "");
    name.onChange(record?.name ?? "");
    // record's own campus_id/location_id always win in edit mode;
    // initialCampusId/initialLocationId (Phase G's pre-fill props) are only
    // consulted for create mode, ahead of the role-driven defaultCampusId
    // fallback -- see this prop's own docstring above.
    setCampusId(record?.campus_id ?? initialCampusId ?? defaultCampusId);
    setDesignationId(record?.designation_id ?? "");
    setLocationId(record?.location_id ?? initialLocationId ?? "");
    setShift(record?.shift ?? "");
    setBlock(record?.block ?? "");
    setFloorVenue(record?.floor_venue ?? "");
    setSupervisor(record?.supervisor ?? "");
    setIsActive(record?.is_active ?? true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id, initialLocationId, initialCampusId]);

  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses, enabled: open });
  const { data: designations } = useQuery({
    queryKey: ["designations", "HOUSEKEEPING"],
    queryFn: () => listDesignations({ category: "HOUSEKEEPING", isActive: true }),
    enabled: open,
  });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: listLocations, enabled: open });

  const campusLocations = (locations ?? []).filter((l) => l.campus_id === campusId && l.is_active);

  function buildPayload() {
    return {
      bio_id: bioId.value.trim(),
      name: name.value.trim(),
      designation_id: designationId,
      location_id: locationId,
      block: block.trim() || null,
      floor_venue: floorVenue.trim() || null,
      shift: shift as HousekeepingShift,
      supervisor: supervisor.trim() || null,
      is_active: isActive,
    };
  }

  function afterSave() {
    setError(null);
    onSaved();
    onOpenChange(false);
  }

  const createMutation = useMutation({
    mutationFn: () => createHousekeepingStaff({ campus_id: campusId, ...buildPayload() }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create housekeeping staff"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateHousekeepingStaff(record!.id, buildPayload()),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update housekeeping staff"),
  });

  function submit() {
    const bioIdValid = bioId.validate();
    const nameValid = name.validate();
    if (!bioIdValid || !nameValid) return;
    if (!campusId) {
      setError("Pick a campus.");
      return;
    }
    if (!designationId) {
      setError("Pick a Housekeeping designation.");
      return;
    }
    if (!locationId) {
      setError("Pick a location.");
      return;
    }
    if (!shift) {
      setError("Pick a shift.");
      return;
    }
    setError(null);
    if (isEdit) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-y-0 top-0 left-auto right-0 h-full w-96 max-w-full translate-x-0 translate-y-0 rounded-none border-l border-border p-6 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit housekeeping staff" : "Add housekeeping staff"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Campus</Label>
            {isEdit || !canChooseCampus ? (
              <p className="text-sm font-mono text-muted-foreground">{campusById.get(campusId)?.code ?? "—"}</p>
            ) : (
              <Select value={campusId} onValueChange={setCampusId}>
                <SelectTrigger aria-label="Campus">
                  <SelectValue placeholder="Select a campus" />
                </SelectTrigger>
                <SelectContent>
                  {(campuses ?? []).filter((c) => c.is_active).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isEdit ? <p className="text-xs text-muted-foreground">Campus can't be changed after creation.</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hk_bio_id">Bio ID</Label>
            <Input
              id="hk_bio_id"
              required
              value={bioId.value}
              onChange={(e) => bioId.onChange(e.target.value)}
              onBlur={bioId.onBlur}
              aria-invalid={Boolean(bioId.error)}
            />
            {bioId.error ? <p className="text-xs text-destructive">{bioId.error}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hk_name">Name</Label>
            <Input
              id="hk_name"
              required
              value={name.value}
              onChange={(e) => name.onChange(e.target.value)}
              onBlur={name.onBlur}
              aria-invalid={Boolean(name.error)}
            />
            {name.error ? <p className="text-xs text-destructive">{name.error}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Designation</Label>
            <Select value={designationId} onValueChange={setDesignationId}>
              <SelectTrigger aria-label="Designation">
                <SelectValue placeholder="Select a Housekeeping designation" />
              </SelectTrigger>
              <SelectContent>
                {(designations ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No Housekeeping designations found.</div>
                ) : (
                  (designations ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={!campusId}>
              <SelectTrigger aria-label="Location">
                <SelectValue placeholder={campusId ? "Select a location" : "Pick a campus first"} />
              </SelectTrigger>
              <SelectContent>
                {campusLocations.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No active locations on this campus.</div>
                ) : (
                  campusLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hk_block">Block (optional)</Label>
              <Input id="hk_block" value={block} onChange={(e) => setBlock(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hk_floor_venue">Floor / Venue (optional)</Label>
              <Input id="hk_floor_venue" value={floorVenue} onChange={(e) => setFloorVenue(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v as HousekeepingShift)}>
              <SelectTrigger aria-label="Shift">
                <SelectValue placeholder="Select a shift" />
              </SelectTrigger>
              <SelectContent>
                {SHIFTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hk_supervisor">Supervisor (optional)</Label>
            <Input id="hk_supervisor" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Active</Label>
            <Select value={isActive ? "true" : "false"} onValueChange={(v) => setIsActive(v === "true")}>
              <SelectTrigger aria-label="Active">
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
            {isSaving ? "Saving…" : isEdit ? "Save changes" : "Add staff"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
