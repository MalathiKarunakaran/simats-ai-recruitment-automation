import type { ApplicationRead, ApplicationStatus } from "@/api/types";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
  statuses: ApplicationStatus[];
}

// The pipeline as a person reads it (key-screens redesign, 2026-10-29):
// several real statuses collapse into one step, the same grouping the
// dashboard's pipeline chart uses. "Waitlisted" appears only for an
// application that has been on the waiting list.
const STEPS: Step[] = [
  { label: "Applied", statuses: ["APPLIED"] },
  { label: "Screening", statuses: ["SCREENING"] },
  { label: "Interview", statuses: ["CALLED_FOR_INTERVIEW", "INTERVIEWED"] },
  { label: "Waitlisted", statuses: ["WAITLISTED"] },
  { label: "Selected", statuses: ["SELECTED"] },
  { label: "Offer", statuses: ["OFFER_SENT", "OFFER_ACCEPTED"] },
  {
    label: "Joined",
    statuses: [
      "JOINING_CONFIRMED",
      "JOINED",
      "PROVISIONAL_ORDER_ISSUED",
      "DEPARTMENT_ROOM_ALLOTTED",
      "ORIENTATION_COMPLETE",
      "HANDED_OVER_TO_HOD",
    ],
  },
];

export function ApplicationProgress({ application }: { application: ApplicationRead }) {
  const ended = application.status === "REJECTED" || application.status === "WITHDRAWN";
  // A closed application is drawn up to where it stopped.
  const position = ended ? application.rejected_at_stage : application.status;
  const wasWaitlisted = application.status === "WAITLISTED" || application.waitlist_rank != null;
  const steps = STEPS.filter((step) => step.label !== "Waitlisted" || wasWaitlisted);
  const currentIndex = position ? steps.findIndex((step) => step.statuses.includes(position)) : -1;

  return (
    <ol aria-label="Progress" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {steps.map((step, index) => {
        const reached = index <= currentIndex;
        const isCurrent = index === currentIndex && !ended;
        const waitlistTone = step.label === "Waitlisted";
        return (
          <li
            key={step.label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-[72px] flex-1 flex-col gap-2"
          >
            <span
              className={cn(
                "h-1.5 rounded-full",
                reached ? (waitlistTone ? "bg-brand-purple" : "bg-primary") : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-xs",
                reached ? "font-semibold text-foreground" : "text-muted-foreground",
                isCurrent && waitlistTone && "text-[#4c1d95] dark:text-purple-300",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
      {ended ? (
        <li aria-current="step" className="flex min-w-[72px] flex-1 flex-col gap-2">
          <span className="h-1.5 rounded-full bg-destructive" />
          <span className="text-xs font-semibold text-destructive">
            {application.status === "REJECTED" ? "Rejected" : "Withdrawn"}
          </span>
        </li>
      ) : null}
    </ol>
  );
}
