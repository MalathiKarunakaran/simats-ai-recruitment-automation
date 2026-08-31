import { useEffect, useState } from "react";

import { PERMISSION_CATEGORIES, PERMISSION_LABELS, PERMISSIONS, type Permission } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccordionItem } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * Order-independent identity for a permission set, so a background refetch
 * that returns the same grants in a different order does NOT count as a
 * change and cannot clobber edits in progress. Both the dirty check and the
 * re-seed effect key off this.
 */
function permissionSetKey(permissions: Iterable<Permission>): string {
  return [...permissions].sort().join("|");
}

interface PermissionCategoryCardsProps {
  /** Page-level saved permission set (UserDetailPage's selectedPermissions). */
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
   * Called on the first edit after a save -- lets the parent clear a stale
   * error from a previously failed save so it doesn't linger over a matrix
   * the user has since changed.
   */
  onEdit?: () => void;
}

/**
 * The Permission Matrix: every permission the backend defines, inline and
 * directly toggleable.
 *
 * Reworked 2026-08-31. It previously rendered six summary cards whose only
 * control was a "Manage Permissions" button opening a drawer -- so from the
 * page itself there was no visible way to grant or revoke anything, and each
 * drawer saved its own category separately.
 *
 * Now: one draft covering ALL categories, edited in place through expandable
 * sections, committed by a single "Save Permissions" button. That single
 * draft is what makes a whole-matrix save honest -- PUT /users/{id}/permissions
 * is a full replace, so a per-category save was always sending the other five
 * categories along with it anyway; this stops pretending otherwise.
 *
 * Nothing about the permission set, its ids, the API, or any authorization
 * rule changes here -- PERMISSION_CATEGORIES/PERMISSION_LABELS/PERMISSIONS
 * remain the only source of what exists, and the server re-checks everything
 * regardless of what this renders.
 */
export function PermissionCategoryCards({
  permissions,
  onPermissionsChange,
  onSave,
  isSaving,
  saveError,
  onEdit,
}: PermissionCategoryCardsProps) {
  const propKey = permissionSetKey(permissions);

  const [draft, setDraft] = useState<ReadonlySet<Permission>>(() => new Set(permissions));
  // What the server is believed to hold. Tracked separately from the
  // `permissions` prop so a successful save settles the dirty flag
  // immediately, rather than waiting for the parent's refetch to echo the new
  // set back -- otherwise the matrix reads "Unsaved changes" over a save that
  // already succeeded.
  const [baseline, setBaseline] = useState<ReadonlySet<Permission>>(() => new Set(permissions));
  // Sections start expanded: the whole point of this rework is that the
  // controls are visible without hunting for them. Collapsing is for getting
  // a long matrix out of the way, not the default state.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  // Re-seed when the SAVED set genuinely changes -- initial load, a
  // successful save, or someone else's change arriving on a refetch. Keyed on
  // content, not array identity, so an identical refetch is a no-op.
  useEffect(() => {
    setDraft(new Set(permissions));
    setBaseline(new Set(permissions));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- propKey IS the content of `permissions`
  }, [propKey]);

  const isDirty = permissionSetKey(draft) !== permissionSetKey(baseline);

  const enabledTotal = draft.size;
  const restrictedTotal = PERMISSIONS.length - enabledTotal;
  const sensitiveTotal = [...draft].filter(isSensitiveOrDestructive).length;

  function markEdited() {
    if (justSaved) setJustSaved(false);
    onEdit?.();
  }

  function togglePermission(permission: Permission, checked: boolean) {
    markEdited();
    setDraft((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  // Select All / Clear All act on the WHOLE group, never on just the rows the
  // search happens to be showing -- a "Select All" that silently skipped
  // filtered-out rows would be a quiet way to grant less than it says.
  function setWholeCategory(categoryPermissions: readonly Permission[], enabled: boolean) {
    markEdited();
    setDraft((prev) => {
      const next = new Set(prev);
      for (const permission of categoryPermissions) {
        if (enabled) next.add(permission);
        else next.delete(permission);
      }
      return next;
    });
  }

  function handleSave() {
    const merged = PERMISSIONS.filter((permission) => draft.has(permission));
    onSave(merged, {
      onSuccess: () => {
        setBaseline(new Set(merged));
        onPermissionsChange(merged);
        setJustSaved(true);
      },
    });
  }

  function handleDiscard() {
    setDraft(new Set(baseline));
    setJustSaved(false);
  }

  const normalizedSearch = search.trim().toLowerCase();
  function visiblePermissions(categoryPermissions: readonly Permission[]): Permission[] {
    if (!normalizedSearch) return [...categoryPermissions];
    return categoryPermissions.filter((permission) =>
      PERMISSION_LABELS[permission].toLowerCase().includes(normalizedSearch),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm backdrop-blur-sm">
        <span>
          Enabled: <span className="font-semibold text-brand-success">{enabledTotal}</span>
        </span>
        <span>
          Restricted: <span className="font-semibold text-muted-foreground">{restrictedTotal}</span>
        </span>
        <span>
          Sensitive: <span className="font-semibold text-brand-warning">{sensitiveTotal}</span>
        </span>
        {isDirty ? (
          <Badge variant="warning" className="ml-auto">
            Unsaved changes
          </Badge>
        ) : null}
      </div>

      <Input
        placeholder="Search permissions…"
        aria-label="Search permissions"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* aria-label disambiguates this grid from the page's own "Administration"
          breadcrumb crumb, "Recruitment" nav item, etc. -- the section headers
          are buttons, not headings, so a bare getByText for a category label
          is otherwise ambiguous. */}
      <div role="region" aria-label="Permission categories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PERMISSION_CATEGORIES.map((category) => {
          const enabledInCategory = category.permissions.filter((p) => draft.has(p));
          const allEnabled = enabledInCategory.length === category.permissions.length;
          const visible = visiblePermissions(category.permissions);
          const isCollapsed = collapsed.has(category.key);
          return (
            <AccordionItem
              key={category.key}
              open={!isCollapsed}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(category.key)) next.delete(category.key);
                  else next.add(category.key);
                  return next;
                })
              }
              trigger={
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="font-medium">{categoryDisplayLabel(category)}</span>
                  <span
                    className={
                      allEnabled
                        ? "shrink-0 text-xs font-semibold text-brand-success"
                        : "shrink-0 text-xs font-medium text-muted-foreground"
                    }
                  >
                    {enabledInCategory.length}/{category.permissions.length}
                  </span>
                </div>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWholeCategory(category.permissions, true)}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWholeCategory(category.permissions, false)}
                  >
                    Clear All
                  </Button>
                </div>

                <div className="flex flex-col gap-1">
                  {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No permissions match this search.</p>
                  ) : (
                    visible.map((permission) => {
                      const checked = draft.has(permission);
                      return (
                        <div
                          key={permission}
                          className={
                            checked
                              ? "flex items-center justify-between gap-3 rounded-md border-l-2 border-brand-success bg-brand-success/5 px-2 py-2"
                              : "flex items-center justify-between gap-3 rounded-md border-l-2 border-transparent px-2 py-2 hover:bg-accent/40"
                          }
                        >
                          <div className="flex items-center gap-2.5">
                            <Switch
                              id={`permission-${permission}`}
                              checked={checked}
                              onCheckedChange={(value) => togglePermission(permission, value)}
                            />
                            <Label
                              htmlFor={`permission-${permission}`}
                              className={checked ? "font-normal" : "font-normal text-muted-foreground"}
                            >
                              {PERMISSION_LABELS[permission]}
                            </Label>
                          </div>
                          {DESTRUCTIVE_PERMISSIONS.has(permission) ? (
                            <Badge variant="destructive">Destructive</Badge>
                          ) : SENSITIVE_PERMISSIONS.has(permission) ? (
                            <Badge variant="warning">Sensitive</Badge>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </AccordionItem>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="button" onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save Permissions"}
        </Button>
        {isDirty ? (
          <Button type="button" variant="outline" onClick={handleDiscard} disabled={isSaving}>
            Discard changes
          </Button>
        ) : null}
        {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
        {justSaved && !isDirty && !saveError ? (
          <p className="text-sm text-brand-success">Permissions saved.</p>
        ) : null}
      </div>
    </div>
  );
}
