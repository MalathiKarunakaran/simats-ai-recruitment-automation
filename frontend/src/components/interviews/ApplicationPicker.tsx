import { useState } from "react";

import type { ApplicationRead } from "@/api/types";
import { Input } from "@/components/ui/input";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";
import { cn } from "@/lib/utils";

interface CandidateLookup {
  full_name: string;
  email: string;
}

interface Props {
  applications: ApplicationRead[];
  getCandidateLabel: (candidateId: string) => CandidateLookup | undefined;
  value: ApplicationRead | null;
  onChange: (application: ApplicationRead) => void;
}

/** Search-then-select-one variant, same shape as CandidatePicker, but over
 * Applications -- used when scheduling an interview without arriving from a
 * specific Application's detail page. */
export function ApplicationPicker({ applications, getCandidateLabel, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const { getLabel } = useJobPostingLookup();

  const matches =
    query.trim().length === 0
      ? []
      : applications.filter((application) => {
          const needle = query.trim().toLowerCase();
          const candidate = getCandidateLabel(application.candidate_id);
          const position = getLabel(application.job_posting_id)?.positionTitle ?? "";
          return (
            candidate?.full_name.toLowerCase().includes(needle) ||
            candidate?.email.toLowerCase().includes(needle) ||
            position.toLowerCase().includes(needle)
          );
        });

  const selectedCandidate = value ? getCandidateLabel(value.candidate_id) : undefined;
  const selectedPosition = value ? getLabel(value.job_posting_id)?.positionTitle : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        placeholder="Search applications by candidate or position"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {value ? (
        <p className="text-sm">
          Selected: <span className="font-medium">{selectedCandidate?.full_name ?? "Unknown candidate"}</span>{" "}
          <span className="text-muted-foreground">for {selectedPosition ?? "Unknown position"}</span>
        </p>
      ) : null}
      {matches.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
          {matches.map((application) => {
            const candidate = getCandidateLabel(application.candidate_id);
            const position = getLabel(application.job_posting_id)?.positionTitle;
            return (
              <li key={application.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent",
                    value?.id === application.id && "bg-accent",
                  )}
                  onClick={() => {
                    onChange(application);
                    setQuery("");
                  }}
                >
                  <span className="font-medium">{candidate?.full_name ?? "Unknown candidate"}</span>
                  <span className="text-xs text-muted-foreground">{position ?? "Unknown position"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
