import { useState } from "react";

import type { CandidateRead } from "@/api/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  candidates: CandidateRead[];
  value: CandidateRead | null;
  onChange: (candidate: CandidateRead) => void;
}

export function CandidatePicker({ candidates, value, onChange }: Props) {
  const [query, setQuery] = useState("");

  const matches =
    query.trim().length === 0
      ? []
      : candidates.filter((c) => {
          const needle = query.trim().toLowerCase();
          return c.full_name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle);
        });

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        placeholder="Search candidates by name or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {value ? (
        <p className="text-sm">
          Selected: <span className="font-medium">{value.full_name}</span>{" "}
          <span className="text-muted-foreground">({value.email})</span>
        </p>
      ) : null}
      {matches.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
          {matches.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent",
                  value?.id === candidate.id && "bg-accent",
                )}
                onClick={() => {
                  onChange(candidate);
                  setQuery("");
                }}
              >
                <span className="font-medium">{candidate.full_name}</span>
                <span className="text-xs text-muted-foreground">{candidate.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
