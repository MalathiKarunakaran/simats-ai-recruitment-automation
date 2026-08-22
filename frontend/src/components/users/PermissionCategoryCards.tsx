import { useMemo, useState } from "react";

import { PERMISSION_CATEGORIES, PERMISSION_LABELS, PERMISSIONS, type Permission } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

// UI-only classification for the "never color-only" Sensitive/Destructive
// text badges below -- deliberately kept out of frontend/src/api/types.ts,
// which mirrors real backend enums/constants 1:1. This is presentation
// judgment, not a generated mirror of anything backend.
const DESTRUCTIVE_PERMISSIONS: ReadonlySet<Permission> = new Set(["DELETE_CANDIDATE"]);
const SENSITIVE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "MANAGE_USERS",
  "MANAGE_CAMPUSES",
  "APPROVE_VACANCY",
  "REJECT_VACANCY",
  "PUBLISH_VACANCY",
  "CLOSE_VACANCY",
  "CANCEL_VACANCY",
  "OFFERS",
  "SETTINGS",
]);

function isSensitiveOrDestructive(permission: Permission): boolean {
  return DESTRUCTIVE_PERMISSIONS.has(permission) || SENSITIVE_PERMISSIONS.has(permission);
}

// Cosmetic-only display label override -- PERMISSION_CATEGORIES' own `key`/
// `permissions` membership (mirroring the backend exactly) is untouched;
// only the label shown for the CANDIDATES category changes here.
const CATEGORY_DISPLAY_LABELS: Record<string, string> = {
  CANDIDATES: "Candidates & Applications",
};

function categoryDisplayLabel(category: { key: string; label: string }): string {
  return CATEGORY_DISPLAY_LABELS[category.key] ?? category.label;
}

interface PermissionCategoryCardsProps {
  /** Page-level full-replace permission set (UserDetailPage's selectedPermissions). */
  permissions: Permission[];
  /** Updates the page-level set -- called only after a successful save. */
  onPermissionsChange: (permissions: Permission[]) => void;
  /**
   * The one real persistence path: UserDetailPage wires this straight to its
   * existing savePermissionsMutation.mutate, so there is exactly one code
   * path that ever calls PUT /users/{id}/permissions, not two divergent ones.
   */
  onSave: (permissions: Permission[], options: { onSuccess: () => void }) => void;
  isSaving: boolean;
  saveError: string | null;
  /**
   * Called whenever a category drawer opens -- lets the parent clear a
   * stale error left over from a previously failed save on a *different*
   * category, so it doesn't linger in a freshly opened drawer that never
   * itself failed.
   */
  onDrawerOpen?: () => void;
}

export function PermissionCategoryCards({
  permissions,
  onPermissionsChange,
  onSave,
  isSaving,
  saveError,
  onDrawerOpen,
}: PermissionCategoryCardsProps) {
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState<ReadonlySet<Permission>>(new Set());
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(permissions), [permissions]);
  const activeCategory = useMemo(
    () => PERMISSION_CATEGORIES.find((category) => category.key === activeCategoryKey) ?? null,
    [activeCategoryKey],
  );

  const enabledTotal = permissions.length;
  const restrictedTotal = PERMISSIONS.length - enabledTotal;
  const sensitiveTotal = permissions.filter(isSensitiveOrDestructive).length;

  function openDrawer(categoryKey: string) {
    const category = PERMISSION_CATEGORIES.find((c) => c.key === categoryKey);
    if (!category) return;
    // Local draft, seeded from the page's current selectedPermissions --
    // Cancel just discards this local state, leaving the page untouched.
    setDraftEnabled(new Set(category.permissions.filter((p) => selectedSet.has(p))));
    setSearch("");
    setActiveCategoryKey(categoryKey);
    onDrawerOpen?.();
  }

  function closeDrawer() {
    setActiveCategoryKey(null);
    setDraftEnabled(new Set());
    setSearch("");
  }

  function toggleDraftPermission(permission: Permission, checked: boolean) {
    setDraftEnabled((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  function handleEnableAll() {
    if (!activeCategory) return;
    setDraftEnabled(new Set(activeCategory.permissions));
  }

  function handleDisableAll() {
    setDraftEnabled(new Set());
  }

  function handleSave() {
    if (!activeCategory) return;
    // Merge this category's draft toggles into the full page-level set --
    // every other category's permissions pass through untouched, so this is
    // always a full replacement covering all 6 categories, never just one.
    const outsideCategory = permissions.filter((p) => !activeCategory.permissions.includes(p));
    const insideCategory = activeCategory.permissions.filter((p) => draftEnabled.has(p));
    const merged = [...outsideCategory, ...insideCategory];
    onSave(merged, {
      onSuccess: () => {
        onPermissionsChange(merged);
        closeDrawer();
      },
    });
  }

  const normalizedSearch = search.trim().toLowerCase();
  // Search only ever narrows which rows are *visible* -- draftEnabled still
  // tracks every permission in the category regardless of the current
  // filter, so a toggle made before searching is never silently lost.
  const visiblePermissions = activeCategory
    ? activeCategory.permissions.filter((permission) =>
        PERMISSION_LABELS[permission].toLowerCase().includes(normalizedSearch),
      )
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm backdrop-blur-sm">
        <span>
          Enabled: <span className="font-semibold text-foreground">{enabledTotal}</span>
        </span>
        <span>
          Restricted: <span className="font-semibold text-foreground">{restrictedTotal}</span>
        </span>
        <span>
          Sensitive: <span className="font-semibold text-brand-warning">{sensitiveTotal}</span>
        </span>
      </div>

      {/* aria-label disambiguates this grid from the page's own "Administration"
          breadcrumb crumb, "Recruitment" nav item, etc. -- CardTitle renders a
          plain <div> (see components/ui/card.tsx), not a heading, so a bare
          getByText for a category label is otherwise ambiguous. */}
      <div
        role="region"
        aria-label="Permission categories"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {PERMISSION_CATEGORIES.map((category) => {
          const enabledInCategory = category.permissions.filter((p) => selectedSet.has(p));
          const preview = enabledInCategory.slice(0, 4);
          const overflow = enabledInCategory.length - preview.length;
          return (
            <Card key={category.key} className="border-brand-primary/20 bg-brand-primary/5 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{categoryDisplayLabel(category)}</CardTitle>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {enabledInCategory.length}/{category.permissions.length}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex min-h-6 flex-wrap gap-1.5">
                  {preview.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No permissions granted yet.</span>
                  ) : (
                    <>
                      {preview.map((permission) => (
                        <Badge key={permission} variant="outline">
                          {PERMISSION_LABELS[permission]}
                        </Badge>
                      ))}
                      {overflow > 0 ? <Badge variant="outline">+{overflow} more</Badge> : null}
                    </>
                  )}
                </div>
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => openDrawer(category.key)}>
                    Manage Permissions
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Sheet
        open={Boolean(activeCategory)}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <SheetContent>
          {activeCategory ? (
            <>
              <SheetHeader>
                <SheetTitle>{categoryDisplayLabel(activeCategory)}</SheetTitle>
                <SheetDescription>
                  {draftEnabled.size}/{activeCategory.permissions.length} enabled
                </SheetDescription>
              </SheetHeader>
              <SheetBody>
                <Input
                  placeholder="Search permissions…"
                  aria-label="Search permissions"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleEnableAll}>
                    Enable All
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleDisableAll}>
                    Disable All
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {visiblePermissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No permissions match this search.</p>
                  ) : (
                    visiblePermissions.map((permission) => (
                      <div
                        key={permission}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/40"
                      >
                        <div className="flex items-center gap-2.5">
                          <Switch
                            id={`permission-${permission}`}
                            checked={draftEnabled.has(permission)}
                            onCheckedChange={(checked) => toggleDraftPermission(permission, checked)}
                          />
                          <Label htmlFor={`permission-${permission}`} className="font-normal">
                            {PERMISSION_LABELS[permission]}
                          </Label>
                        </div>
                        {DESTRUCTIVE_PERMISSIONS.has(permission) ? (
                          <Badge variant="destructive">Destructive</Badge>
                        ) : SENSITIVE_PERMISSIONS.has(permission) ? (
                          <Badge variant="warning">Sensitive</Badge>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </SheetBody>
              <SheetFooter>
                {saveError ? <p className="mr-auto self-center text-sm text-destructive">{saveError}</p> : null}
                <Button type="button" variant="outline" onClick={closeDrawer} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
