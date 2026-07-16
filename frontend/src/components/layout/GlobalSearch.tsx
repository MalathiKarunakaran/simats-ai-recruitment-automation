import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { listCandidates } from "@/api/candidates";
import { listVacancyRequests } from "@/api/vacancyRequests";
import { Input } from "@/components/ui/input";

interface Result {
  id: string;
  label: string;
  sublabel: string;
  to: string;
}

// A quick-navigate combobox over what's already fetchable client-side, not
// a backend full-text search index -- this system has no unified search
// endpoint, so results are limited to candidates (matched by name or
// email) and vacancy requests (matched by position title) among the first
// 200 rows of each. Good enough to jump to a known record fast; not a
// substitute for a real search backend if the data set grows much larger.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: candidates } = useQuery({ queryKey: ["candidates", ""], queryFn: () => listCandidates() });
  const { data: vacancyRequests } = useQuery({
    queryKey: ["vacancy-requests", "ALL"],
    queryFn: () => listVacancyRequests(null),
  });

  const normalizedQuery = query.trim().toLowerCase();
  const results: Result[] =
    normalizedQuery.length < 2
      ? []
      : [
          ...(candidates ?? [])
            .filter(
              (c) =>
                c.full_name.toLowerCase().includes(normalizedQuery) ||
                c.email.toLowerCase().includes(normalizedQuery),
            )
            .slice(0, 5)
            .map((c) => ({ id: c.id, label: c.full_name, sublabel: c.email, to: `/candidates/${c.id}` })),
          ...(vacancyRequests ?? [])
            .filter((vr) => vr.position_title.toLowerCase().includes(normalizedQuery))
            .slice(0, 5)
            .map((vr) => ({
              id: vr.id,
              label: vr.position_title,
              sublabel: `Vacancy request · ${vr.status.replace(/_/g, " ")}`,
              to: `/vacancy-requests/${vr.id}`,
            })),
        ];

  function handleSelect(result: Result) {
    setQuery("");
    setOpen(false);
    navigate(result.to);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search candidates, vacancies…"
        className="pl-8"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && normalizedQuery.length >= 2 ? (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No matches.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {results.map((result) => (
                <li key={result.to}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(result)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{result.label}</span>
                    <span className="text-xs text-muted-foreground">{result.sublabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
