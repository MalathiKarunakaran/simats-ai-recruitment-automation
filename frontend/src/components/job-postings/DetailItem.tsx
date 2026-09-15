import type { ReactNode } from "react";

/** One labelled fact in a job posting section. `children` of null/"" shows a dash. */
export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{empty ? <span className="text-muted-foreground">—</span> : children}</dd>
    </div>
  );
}
