// "Last updated by ‹name› · ‹relative time›" (pipeline brief Phase 6). The
// who and when come from the backend's newest audit row on the application or
// its joining-stage records (ApplicationRead.last_updated_by_name/_at). A row
// with no actor is a system or sync write and reads "System". The absolute
// time, in IST, is on the tooltip.

import { relativeTime } from "@/lib/relativeTime";

const absoluteFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export function LastUpdatedBy({
  name,
  at,
  withLabel = false,
  className,
}: {
  name: string | null | undefined;
  at: string | null | undefined;
  // true in headers/cards ("Last updated by Asha · 2 hr ago"); false in a
  // table column whose heading already says it.
  withLabel?: boolean;
  className?: string;
}) {
  if (!at) {
    return withLabel ? null : <span className={className}>—</span>;
  }
  const date = new Date(at);
  const who = name ?? "System";
  return (
    <span className={className} title={`${absoluteFormat.format(date)} IST`}>
      {withLabel ? "Last updated by " : null}
      {who} · {relativeTime(date)}
    </span>
  );
}
