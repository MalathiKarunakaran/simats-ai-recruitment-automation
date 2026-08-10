import { Check, X } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// No click-to-edit pattern exists elsewhere in this codebase to copy --
// this establishes one for the Sanctioned Strength breakdown's "Approved"
// column (zany-snuggling-pie.md Phase D, item 1). Deliberately small and
// local: no generalized "InlineEditableCell<T>" abstraction, just this one
// non-negative-integer case. The caller (SanctionedStrengthPage's
// DepartmentBreakdownRow) owns the POST-vs-PATCH decision and the actual
// mutation/query-invalidation -- this component only owns the click ->
// edit -> commit/cancel interaction and input validation.

const NON_NEGATIVE_INTEGER = /^\d+$/;

export interface InlineNumberCellProps {
  /** Current approved value -- always a number (0 when no SanctionedStrength
   * row exists yet for this designation), never null; the "does a row exist"
   * distinction lives in the caller's `sanctioned_strength_id`, not here. */
  value: number;
  /** Resolves `true` on a successful save (exits edit mode) or `false` on
   * failure (stays in edit mode so the user can see `saveError` and retry --
   * never throws, so there's nothing for this component to catch). */
  onSave: (nextValue: number) => Promise<boolean>;
  /** RBAC gate mirror -- when true, renders the plain number with no click
   * affordance at all (not even a disabled button), same "just don't render
   * the write affordance" convention as DesignationsPage's canManage. */
  readOnly?: boolean;
  isSaving?: boolean;
  saveError?: string | null;
  "aria-label"?: string;
}

export function InlineNumberCell({
  value,
  onSave,
  readOnly = false,
  isSaving = false,
  saveError = null,
  "aria-label": ariaLabel,
}: InlineNumberCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const isValid = NON_NEGATIVE_INTEGER.test(trimmed);

  function startEdit() {
    if (readOnly) return;
    setDraft(String(value));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  async function commit() {
    if (!isValid) return;
    const succeeded = await onSave(Number(trimmed));
    if (succeeded) {
      setEditing(false);
      setDraft("");
    }
  }

  if (!editing) {
    return readOnly ? (
      <span className="tabular-nums" aria-label={ariaLabel}>
        {value}
      </span>
    ) : (
      <button
        type="button"
        onClick={startEdit}
        aria-label={ariaLabel ?? `Edit approved value (currently ${value})`}
        className="rounded px-1 tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 transition-colors hover:bg-accent hover:text-foreground"
      >
        {value}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={draft}
          disabled={isSaving}
          aria-label={ariaLabel ? `${ariaLabel} value` : "Approved value"}
          aria-invalid={trimmed !== "" && !isValid}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="h-7 w-20 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!isValid || isSaving}
          aria-label="Save"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded text-brand-success transition-colors hover:bg-accent",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isSaving}
          aria-label="Cancel"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {trimmed !== "" && !isValid ? (
        <p className="text-xs text-destructive">Enter a whole number, 0 or more.</p>
      ) : null}
      {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
    </div>
  );
}
