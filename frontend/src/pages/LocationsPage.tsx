import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { listCampuses } from "@/api/campuses";
import { createLocation, deleteLocation, listLocations, updateLocation } from "@/api/locations";
import { GLOBAL_SCOPE_ROLES, LOCATION_MANAGEMENT_ROLES, type LocationRead, type StaffRoleCategory } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { LocationBulkUploadDialog } from "@/components/locations/LocationBulkUploadDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CategoryTabs } from "@/components/domain/CategoryTabs";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";
import { useCategoryTabState } from "@/hooks/useCategoryTabState";
import { required, useFieldValidation } from "@/hooks/useFieldValidation";

const CATEGORIES: StaffRoleCategory[] = ["TEACHING", "NON_TEACHING", "HOUSEKEEPING"];

interface FormState {
  campusId: string;
  blockBuilding: string;
  floorVenue: string;
  category: StaffRoleCategory | "";
  isActive: boolean;
}

const EMPTY_FORM: FormState = { campusId: "", blockBuilding: "", floorVenue: "", category: "", isActive: true };

export function LocationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const name = useFieldValidation("", required("Location name is required"));
  const [error, setError] = useState<string | null>(null);
  // Phase J (glowing-zooming-hamming.md) -- "Upload history" is a plain
  // Dialog wrapping the now-generalized UploadHistoryTab, not a page Tab:
  // unlike SanctionedStrengthPage, this page has no existing Tabs section to
  // add a third tab to, and a whole page-level mode switch would be
  // disproportionate to an occasional "check past bulk uploads" action.
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  const [campusFilter, setCampusFilter] = useState<string>("ALL");
  // URL-persisted via ?category=... (see hooks/useCategoryTabState.ts) so
  // the selection survives refresh/back-forward/shared links.
  const [categoryTab, setCategoryTab] = useCategoryTabState();
  // Defaults to Active-only -- matches the backend's own include_inactive=false
  // default for GET /locations, re-implemented here client-side since
  // api/locations.ts's listLocations() fetches the full list (active +
  // inactive) so this filter, the campus filter, and the category tabs can
  // all narrow it without a network round-trip per change.
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("true");
  const [search, setSearch] = useState("");

  const { data: locations, isLoading } = useQuery({ queryKey: ["locations"], queryFn: listLocations });
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const canManage = Boolean(user && LOCATION_MANAGEMENT_ROLES.includes(user.role));
  // A single-campus role's own locations are already all on one campus, so
  // the campus filter would only ever have one meaningful option -- same
  // rationale as ActivityLogPage/SanctionedStrengthPage's own
  // canFilterByCampus gate (mirrors app/core/deps.py's GLOBAL_SCOPE_ROLES).
  const canFilterByCampus = Boolean(user && GLOBAL_SCOPE_ROLES.includes(user.role));

  const campusById = new Map((campuses ?? []).map((c) => [c.id, c]));

  const filtersActive =
    campusFilter !== "ALL" || categoryTab !== "ALL" || activeFilter !== "true" || search.trim() !== "";
  // Every filter except the category tab -- shared between the visible list
  // and the CategoryTabs counts, so each tab's count reflects "how many in
  // this category, given the *other* active filters" (campus/active/search),
  // not the whole unfiltered list.
  const preCategoryFiltered = (locations ?? [])
    .filter((l) => campusFilter === "ALL" || l.campus_id === campusFilter)
    .filter((l) => activeFilter === "ALL" || (activeFilter === "true" ? l.is_active : !l.is_active))
    .filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase()));
  const categoryTabCounts = {
    // Locations with no category (unlike Department, Location.category is
    // nullable -- a building can serve multiple staff categories, or none
    // yet) only ever show up here, never under Teaching/Non-Teaching/
    // Housekeeping below -- the `.category === "..."` filters below already
    // exclude a null category, so no special-casing is needed beyond that.
    all: preCategoryFiltered.length,
    teaching: preCategoryFiltered.filter((l) => l.category === "TEACHING").length,
    nonTeaching: preCategoryFiltered.filter((l) => l.category === "NON_TEACHING").length,
    housekeeping: preCategoryFiltered.filter((l) => l.category === "HOUSEKEEPING").length,
  };
  // Same nullable-category consequence as the counts above: an uncategorized
  // location only ever renders on the "All" tab, never a specific-category
  // one -- never silently dropped from the page as a whole, just scoped out
  // of tabs that don't apply to it.
  const visibleLocations = preCategoryFiltered
    .filter((l) => categoryTab === "ALL" || l.category === categoryTab)
    .sort((a, b) => a.name.localeCompare(b.name));

  function afterSave() {
    setError(null);
    setDialogOpen(false);
    setEditingId(null);
    void queryClient.invalidateQueries({ queryKey: ["locations"] });
  }

  function buildPayload() {
    return {
      name: name.value,
      block_building: form.blockBuilding.trim() || null,
      floor_venue: form.floorVenue.trim() || null,
      category: form.category || null,
      is_active: form.isActive,
    };
  }

  const createMutation = useMutation({
    mutationFn: () => createLocation({ campus_id: form.campusId, ...buildPayload() }),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create location"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateLocation(editingId!, buildPayload()),
    onSuccess: afterSave,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update location"),
  });

  function openCreateDialog() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      // Single-campus roles (e.g. RECRUITMENT_OFFICER) have exactly one
      // valid campus to create against -- default straight to it, same
      // "isSuperAdmin ? '' : user.campus_id" resolution VacancyRequestForm
      // uses for a create-mode campus field, generalized to any
      // non-global-scope role since RECRUITMENT_OFFICER writes here too.
      campusId: canFilterByCampus ? "" : (user?.campus_id ?? ""),
    });
    name.onChange("");
    setError(null);
    setDialogOpen(true);
  }

  function openEditDialog(location: LocationRead) {
    setEditingId(location.id);
    setForm({
      campusId: location.campus_id,
      blockBuilding: location.block_building ?? "",
      floorVenue: location.floor_venue ?? "",
      category: location.category ?? "",
      isActive: location.is_active,
    });
    name.onChange(location.name);
    setError(null);
    setDialogOpen(true);
  }

  function submit() {
    if (!name.validate()) return;
    if (!editingId && !form.campusId) {
      setError("Pick a campus.");
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
    return <p className="text-sm text-muted-foreground">Only staff can view Locations.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Locations"
        description="The location master -- campus, block/building, floor/venue, and category, per location."
        actions={
          canManage ? (
            <>
              {/* Phase J (glowing-zooming-hamming.md) -- gated on the same
                  canManage (LOCATION_MANAGEMENT_ROLES) check as New
                  location/Edit/Delete below, mirroring the backend's own
                  _WRITE_ROLES gate on /locations/bulk-upload/*. */}
              <LocationBulkUploadDialog />
              <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    Upload history
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Location bulk upload history</DialogTitle>
                  </DialogHeader>
                  <UploadHistoryTab entityType="LOCATION" />
                </DialogContent>
              </Dialog>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={openCreateDialog}>New location</Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? "Edit location" : "New location"}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>Campus</Label>
                    {editingId || !canFilterByCampus ? (
                      <p className="text-sm font-mono text-muted-foreground">
                        {campusById.get(form.campusId)?.code ?? "—"}
                      </p>
                    ) : (
                      <Select value={form.campusId} onValueChange={(v) => setForm((f) => ({ ...f, campusId: v }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a campus" />
                        </SelectTrigger>
                        <SelectContent>
                          {(campuses ?? []).filter((campus) => campus.is_active).map((campus) => (
                            <SelectItem key={campus.id} value={campus.id}>
                              {campus.code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {editingId ? (
                      <p className="text-xs text-muted-foreground">Campus can't be changed after creation.</p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="location_name">Name</Label>
                    <Input
                      id="location_name"
                      required
                      value={name.value}
                      onChange={(e) => name.onChange(e.target.value)}
                      onBlur={name.onBlur}
                      aria-invalid={Boolean(name.error)}
                    />
                    {name.error ? <p className="text-xs text-destructive">{name.error}</p> : null}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="location_block_building">Block / Building (optional)</Label>
                      <Input
                        id="location_block_building"
                        value={form.blockBuilding}
                        onChange={(e) => setForm((f) => ({ ...f, blockBuilding: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="location_floor_venue">Floor / Venue (optional)</Label>
                      <Input
                        id="location_floor_venue"
                        value={form.floorVenue}
                        onChange={(e) => setForm((f) => ({ ...f, floorVenue: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Teaching / Non-Teaching / Housekeeping (optional)</Label>
                    <Select
                      value={form.category || "NONE"}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, category: v === "NONE" ? "" : (v as StaffRoleCategory) }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Not set" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Not set</SelectItem>
                        {CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category.replace(/_/g, " ")}
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
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button disabled={isSaving} onClick={submit}>
                    {isSaving ? "Saving…" : editingId ? "Save changes" : "Create location"}
                  </Button>
                </DialogFooter>
              </DialogContent>
              </Dialog>
            </>
          ) : undefined
        }
      />

      <CategoryTabs value={categoryTab} onValueChange={setCategoryTab} counts={categoryTabCounts} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          aria-label="Search locations"
          className="sm:max-w-xs"
        />
        {canFilterByCampus ? (
          <Select value={campusFilter} onValueChange={setCampusFilter}>
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
        ) : null}
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
      ) : visibleLocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filtersActive ? "No locations match the current filters." : "No locations found."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Block / Building</th>
              <th className="py-2 font-medium">Floor / Venue</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Category</th>
              <th className="py-2 font-medium">Status</th>
              {canManage ? <th className="py-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleLocations.map((location) => (
              <tr key={location.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="py-2 font-medium text-foreground">{location.name}</td>
                <td className="py-2">{location.block_building ?? "—"}</td>
                <td className="py-2">{location.floor_venue ?? "—"}</td>
                <td className="py-2 font-mono text-xs">{campusById.get(location.campus_id)?.code ?? "—"}</td>
                <td className="py-2">{location.category ? location.category.replace(/_/g, " ") : "—"}</td>
                <td className="py-2">
                  <Badge variant={location.is_active ? "success" : "destructive"}>
                    {location.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(location)}>
                        Edit
                      </Button>
                      <DeleteConfirmDialog
                        triggerAriaLabel={`Delete location ${location.name}`}
                        title="Delete location"
                        description={
                          <>
                            Remove <span className="font-medium text-foreground">{location.name}</span>? This is a
                            soft delete -- the location stays visible (as Inactive) and can be reactivated later.
                          </>
                        }
                        onDelete={() => deleteLocation(location.id)}
                        onDeleted={() => void queryClient.invalidateQueries({ queryKey: ["locations"] })}
                      />
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
