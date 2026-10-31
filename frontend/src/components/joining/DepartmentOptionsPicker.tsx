import type { DepartmentOption } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The department choices for allotment (docs/specs/provisional-order-and-
 * allotment.md, Q4): vacancy per department, suggested ones first (the
 * backend already orders them) and marked, zero-vacancy ones disabled
 * unless the viewer is a Super Admin (who must then give a reason). */
export function DepartmentOptionsPicker({
  options,
  value,
  onChange,
  allowZeroVacancy,
}: {
  options: DepartmentOption[];
  value: string;
  onChange: (departmentId: string) => void;
  allowZeroVacancy: boolean;
}) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No department has a Sanctioned Strength row for this designation on this campus.
      </p>
    );
  }
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Department</legend>
      {options.map((option) => {
        const full = option.vacancy <= 0;
        const disabled = full && !allowZeroVacancy;
        return (
          <label
            key={option.department_id}
            className={cn(
              "flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm",
              value === option.department_id && "border-primary",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name="department_option"
              value={option.department_id}
              checked={value === option.department_id}
              disabled={disabled}
              onChange={() => onChange(option.department_id)}
            />
            <span className="flex-1">
              <span className="font-medium">{option.department_name}</span>
              {option.suggested ? (
                <Badge variant="success" className="ml-2">
                  Suggested
                </Badge>
              ) : null}
            </span>
            <span className={cn("text-xs", full ? "text-destructive" : "text-muted-foreground")}>
              {full ? "No vacancy" : `${option.vacancy} vacant`} · sanctioned {option.sanctioned}, working{" "}
              {option.working}
              {option.reserved > 0 ? `, reserved ${option.reserved}` : ""}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
