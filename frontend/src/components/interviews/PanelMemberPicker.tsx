import type { UserRead } from "@/api/types";
import { cn } from "@/lib/utils";

interface Props {
  candidates: UserRead[];
  value: string[];
  onChange: (panelMemberIds: string[]) => void;
}

/** Multi-select variant of CandidatePicker -- click-to-toggle rows instead
 * of search-then-select-one, since a schedule needs at least one panel
 * member (mirrors the backend's Field(min_length=1)) and often more. */
export function PanelMemberPicker({ candidates, value, onChange }: Props) {
  function toggle(userId: string) {
    if (value.includes(userId)) {
      onChange(value.filter((id) => id !== userId));
    } else {
      onChange([...value, userId]);
    }
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">No interview panel members available for this campus.</p>;
  }

  return (
    <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
      {candidates.map((member) => {
        const selected = value.includes(member.id);
        return (
          <li key={member.id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent",
                selected && "bg-accent",
              )}
              onClick={() => toggle(member.id)}
            >
              <span>
                <span className="font-medium">{member.full_name}</span>{" "}
                <span className="text-xs text-muted-foreground">({member.email})</span>
              </span>
              {selected ? <span className="text-xs font-medium">Selected</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
