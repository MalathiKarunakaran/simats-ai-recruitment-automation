import { useQuery } from "@tanstack/react-query";
import { Briefcase, CalendarClock, MapPin, Search, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listPublicPostings, type PublicJobPostingSummary } from "@/api/publicCareers";
import type { StaffRoleCategory } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_LABELS, formatDate, formatEmploymentType } from "@/lib/careersDisplay";

// The public careers list (2026-09-07). Mounted OUTSIDE ProtectedRoute and
// AppShell like the QR vacancy-request form: no navigation, no campus
// switcher, no link into the staff console. A candidate browsing here should
// see the institution's openings and nothing else.
//
// Filters are server-side (the endpoint takes campus / role_category / q) so
// the page never holds more than the current answer -- and the campus list is
// derived from the postings themselves rather than fetched from master data,
// because a campus with nothing open is not a useful filter option.

const ALL = "__all__";

function PostingCard({ posting }: { posting: PublicJobPostingSummary }) {
  return (
    <li>
      <Link
        to={`/careers/${encodeURIComponent(posting.public_apply_slug)}`}
        className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${posting.title} at ${posting.campus_code}`}
      >
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">{posting.title}</h2>
              <Badge variant="outline">{CATEGORY_LABELS[posting.role_category]}</Badge>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <dt className="sr-only">Campus and department</dt>
                <dd>
                  {posting.campus_code} · {posting.department_name}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <Briefcase className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <dt className="sr-only">Employment type</dt>
                <dd>{formatEmploymentType(posting.employment_type)}</dd>
              </div>
              <div className="flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <dt className="sr-only">Positions</dt>
                <dd>
                  {posting.positions_open} {posting.positions_open === 1 ? "position" : "positions"}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <dt className="sr-only">Apply by</dt>
                <dd>{posting.apply_deadline ? `Apply by ${formatDate(posting.apply_deadline)}` : "Open until filled"}</dd>
              </div>
            </dl>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Qualification:</span> {posting.qualification}
            </p>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

export function PublicCareersPage() {
  const [campus, setCampus] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState("");

  const filters = {
    campus: campus === ALL ? undefined : campus,
    role_category: category === ALL ? undefined : (category as StaffRoleCategory),
    q: search,
  };
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-postings", filters],
    queryFn: () => listPublicPostings(filters),
  });

  // The campus filter offers only campuses that currently have something
  // open. Fetched once, unfiltered, so picking a campus does not shrink its
  // own option list.
  const { data: unfiltered } = useQuery({
    queryKey: ["public-postings", "all"],
    queryFn: () => listPublicPostings(),
  });
  const campuses = [...new Map((unfiltered?.items ?? []).map((p) => [p.campus_code, p.campus_name])).entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  );

  const items = data?.items ?? [];
  const filtersActive = campus !== ALL || category !== ALL || search.trim() !== "";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">SIMATS Careers</p>
        <h1 className="font-display text-2xl font-bold text-foreground">Current openings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Teaching, non-teaching and support positions across the SIMATS campuses. Choose a posting to read
          more and apply.
        </p>
      </header>

      <Card className="mb-6">
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 sm:col-span-1">
            <Label htmlFor="search">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="search"
                type="search"
                placeholder="Position title"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Campus</Label>
            <Select value={campus} onValueChange={setCampus}>
              <SelectTrigger aria-label="Campus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All campuses</SelectItem>
                {campuses.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {code} — {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {(Object.keys(CATEGORY_LABELS) as StaffRoleCategory[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-center text-sm text-muted-foreground">Loading openings…</p>
      ) : isError ? (
        <p role="alert" className="text-center text-sm text-destructive">
          Could not load the current openings. Please try again in a moment.
        </p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {filtersActive
              ? "No openings match these filters."
              : "There are no openings at the moment. Please check back soon."}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
            {data?.total} {data?.total === 1 ? "opening" : "openings"}
          </p>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((posting) => (
              <PostingCard key={posting.public_apply_slug} posting={posting} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
