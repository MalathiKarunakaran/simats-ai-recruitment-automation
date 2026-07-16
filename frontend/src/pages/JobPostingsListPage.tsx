import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listCampuses } from "@/api/campuses";
import { Badge } from "@/components/ui/badge";
import { useJobPostingLookup } from "@/hooks/useJobPostingLookup";

export function JobPostingsListPage() {
  const { jobPostings, getLabel, isLoading } = useJobPostingLookup();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Job Postings</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !jobPostings || jobPostings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No job postings in this scope yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">Position</th>
              <th className="py-2 font-medium">Campus</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Published</th>
            </tr>
          </thead>
          <tbody>
            {jobPostings.map((jp) => {
              const campus = campuses?.find((c) => c.id === jp.campus_id);
              const label = getLabel(jp.id);
              return (
                <tr key={jp.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="py-2">
                    <Link to={`/job-postings/${jp.id}`} className="font-medium hover:underline">
                      {label?.positionTitle ?? "Unknown position"}
                    </Link>
                  </td>
                  <td className="py-2 font-mono text-xs">{campus?.code ?? "—"}</td>
                  <td className="py-2">
                    <Badge variant={jp.is_active ? "success" : "outline"}>
                      {jp.is_active ? "Active" : "Closed"}
                    </Badge>
                  </td>
                  <td className="py-2">{new Date(jp.published_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
