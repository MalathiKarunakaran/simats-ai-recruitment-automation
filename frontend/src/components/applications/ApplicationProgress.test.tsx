import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApplicationRead } from "@/api/types";
import { ApplicationProgress } from "@/components/applications/ApplicationProgress";

function app(overrides: Partial<ApplicationRead>): ApplicationRead {
  return {
    status: "APPLIED",
    rejected_at_stage: null,
    waitlist_rank: null,
    ...overrides,
  } as ApplicationRead;
}

function steps() {
  return within(screen.getByRole("list", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("ApplicationProgress", () => {
  it("leaves Waitlisted out for an application never on the waiting list", () => {
    render(<ApplicationProgress application={app({ status: "SELECTED" })} />);
    expect(steps()).toEqual(["Applied", "Screening", "Interview", "Selected", "Offer", "Joined"]);
    expect(screen.getByText("Selected").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("marks Waitlisted as the current step, and keeps it after promotion", () => {
    const { rerender } = render(<ApplicationProgress application={app({ status: "WAITLISTED", waitlist_rank: 1 })} />);
    expect(screen.getByText("Waitlisted").closest("li")).toHaveAttribute("aria-current", "step");

    rerender(<ApplicationProgress application={app({ status: "SELECTED", waitlist_rank: 1 })} />);
    expect(steps()).toContain("Waitlisted");
    expect(screen.getByText("Selected").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("draws a rejection up to the stage it happened at, then Rejected", () => {
    render(<ApplicationProgress application={app({ status: "REJECTED", rejected_at_stage: "INTERVIEWED" })} />);
    expect(steps().at(-1)).toBe("Rejected");
    expect(screen.getByText("Rejected").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Interview")).toHaveClass("font-semibold");
    expect(screen.getByText("Selected")).not.toHaveClass("font-semibold");
  });
});
