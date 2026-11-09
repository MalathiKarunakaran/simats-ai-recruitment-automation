import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { DashboardPipelineExtras } from "@/api/dashboard";
import { JoiningPipelineTiles } from "@/components/dashboard/JoiningPipelineTiles";

const SHEET: DashboardPipelineExtras = {
  scope_note: "",
  sheet_visible: true,
  sheet_ignores_campus: true,
  month: "2026-10",
  today: "2026-10-31",
  waitlisted: { total: 217, applications: 1, applications_by_category: { TEACHING: 1 }, talent_pool_final: 180, talent_pool_nts: 36 },
  sent_to_university: { total: 11, batches: 2, members: 11 },
  provisional_orders_this_month: { total: 9, order_register: 8, appointment_orders: 1 },
  awaiting_hod_review: { total: 5, applications: 1, sheet_overdue: 4 },
  awaiting_permanent_order: { total: 3, applications: 3 },
  pipeline_extension: [],
  talent_pool_outcomes: null,
  talent_pool_waiting_preview: null,
};

const NO_SHEET: DashboardPipelineExtras = {
  ...SHEET,
  sheet_visible: false,
  waitlisted: { total: 2, applications: 2, applications_by_category: { NON_TEACHING: 2 }, talent_pool_final: null, talent_pool_nts: null },
  sent_to_university: { total: 0, batches: null, members: null },
  provisional_orders_this_month: { total: 1, order_register: null, appointment_orders: 1 },
  awaiting_hod_review: { total: 1, applications: 1, sheet_overdue: null },
};

function renderTiles(data: DashboardPipelineExtras | undefined, isLoading = false) {
  return render(
    <MemoryRouter>
      <JoiningPipelineTiles data={data} isLoading={isLoading} />
    </MemoryRouter>,
  );
}

function tileLink(label: string) {
  return screen.getByText(label, { exact: true }).closest("a");
}

describe("JoiningPipelineTiles", () => {
  it("shows the five totals with their breakdowns and links", () => {
    renderTiles(SHEET);
    expect(screen.getByRole("heading", { name: "Joining pipeline" })).toBeInTheDocument();

    // Teaching and Non-teaching waiting lists are separate tiles, never summed.
    expect(screen.getByText("181")).toBeInTheDocument();
    expect(screen.getByText("Final sheet 180 · app 1")).toBeInTheDocument();
    expect(tileLink("Waitlisted (Teaching)")).toHaveAttribute("href", "/talent-pool?status=Waiting%20List#register");
    expect(screen.getByText("36")).toBeInTheDocument();
    expect(screen.getByText("NTS sheet 36 · app 0")).toBeInTheDocument();
    expect(tileLink("Waitlisted (Non-teaching)")).toHaveAttribute("href", "/talent-pool?status=Waiting%20List&tab=nts#register");
    expect(screen.queryByText("217")).not.toBeInTheDocument();
    expect(screen.queryByText("Waitlisted (Housekeeping)")).not.toBeInTheDocument();

    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("11 people · 2 batches")).toBeInTheDocument();
    expect(tileLink("Sent to University (pending)")).toHaveAttribute("href", "/selection-batches?status=SENT_TO_UNIVERSITY");

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText(/register 8 · app 1$/)).toBeInTheDocument();
    expect(tileLink("Provisional orders issued (this month)")).toHaveAttribute("href", "/provisional-orders");

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("probation overdue 4 · app 1")).toBeInTheDocument();
    expect(tileLink("Awaiting HOD review")).toHaveAttribute("href", "/provisional-orders?probation=overdue#list");

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("app 3")).toBeInTheDocument();
    expect(tileLink("Awaiting permanent order")).toHaveAttribute("href", "/onboarding?stage=HOD_REVIEW_COMPLETE");
  });

  it("says the sheet sources ignore the campus switcher", () => {
    renderTiles(SHEET);
    expect(screen.getAllByText(/campus switcher does not narrow them/).length).toBeGreaterThan(0);
  });

  it("for a role without the sheet pages: app counts only, no batch tile, no links to those pages", () => {
    renderTiles(NO_SHEET);
    expect(screen.queryByText("Sent to University (pending)")).not.toBeInTheDocument();
    expect(screen.getByText("app 2")).toBeInTheDocument();
    expect(tileLink("Waitlisted (Teaching)")).toBeNull();
    expect(tileLink("Waitlisted (Non-teaching)")).toBeNull();
    expect(tileLink("Provisional orders issued (this month)")).toBeNull();
    expect(tileLink("Awaiting HOD review")).toBeNull();
    expect(screen.queryByText(/register/)).not.toBeInTheDocument();
    expect(tileLink("Awaiting permanent order")).toHaveAttribute("href", "/onboarding?stage=HOD_REVIEW_COMPLETE");
  });

  it("adds a Housekeeping waitlisted tile only when the app has someone waiting there", () => {
    renderTiles({ ...SHEET, waitlisted: { ...SHEET.waitlisted, applications: 3, applications_by_category: { TEACHING: 1, HOUSEKEEPING: 2 } } });
    expect(screen.getByText("Waitlisted (Housekeeping)")).toBeInTheDocument();
    expect(screen.getByText("app 2")).toBeInTheDocument();
  });

  it("shows skeletons while loading", () => {
    renderTiles(undefined, true);
    expect(screen.getByRole("status", { name: "Loading Waitlisted (Teaching)" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading Waitlisted (Non-teaching)" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading Awaiting permanent order" })).toBeInTheDocument();
  });
});
