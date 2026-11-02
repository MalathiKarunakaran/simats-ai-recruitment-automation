import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as talentPoolApi from "@/api/talentPool";
import type { TalentPoolSelectedBreakdown } from "@/api/types";
import { SelectedBreakdownSheet } from "@/components/talentPool/SelectedBreakdownSheet";

vi.mock("@/api/talentPool");
const mockedGet = vi.mocked(talentPoolApi.getSelectedBreakdown);

const empty = { items: [], recorded: 0 };
const breakdown: TalentPoolSelectedBreakdown = {
  source_tab: "TEACHING_FINAL",
  total: 454,
  department: { items: [{ label: "ECE", count: 117 }], recorded: 432 },
  college: { items: [{ label: "SSE", count: 12 }], recorded: 12 },
  state: empty,
  country: empty,
  gender: { items: [{ label: "Female", count: 7 }], recorded: 7 },
};

function renderSheet(search: string, open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SelectedBreakdownSheet
          open={open}
          tab="TEACHING_FINAL"
          deptMode="group"
          currentParams={new URLSearchParams(search)}
          onClose={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SelectedBreakdownSheet", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue(breakdown);
  });

  it("fetches nothing until it is opened", () => {
    renderSheet("", false);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("says how much of the total each card covers", async () => {
    renderSheet("view=selected");
    expect(await screen.findByText("Recorded for 432 of 454")).toBeInTheDocument();
    expect(screen.getByText("Recorded for 12 of 454")).toBeInTheDocument();
    expect(screen.getByText("Selected candidates: 454")).toBeInTheDocument();
  });

  it("names the sheet column to fill when a card has no data", async () => {
    renderSheet("view=selected");
    expect(await screen.findByText("Not recorded yet. Fill the State column in the Final sheet.")).toBeInTheDocument();
    expect(screen.getByText("Not recorded yet. Fill the Country column in the Final sheet.")).toBeInTheDocument();
  });

  it("a bar lists Selected candidates with that value, closes the panel and drops an earlier narrowing", async () => {
    renderSheet("view=selected&department=Nursing&q=asha");
    const href = (await screen.findByRole("link", { name: /^SSE: 12/ })).getAttribute("href")!;
    expect(href).toContain("status=Selected");
    expect(href).toContain("college=SSE");
    expect(href).not.toContain("department");
    expect(href).not.toContain("q=asha");
    expect(href).not.toContain("view=");
    expect(href.endsWith("#register")).toBe(true);
  });

  it("opens with focus on the panel itself, so nothing scrolls it down", async () => {
    renderSheet("view=selected");
    await screen.findByText("Recorded for 432 of 454");
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("colours Male and Female by name, whichever is larger", async () => {
    renderSheet("view=selected");
    const legend = await screen.findByRole("link", { name: /Female: 7/ });
    expect(legend.querySelector("span")!.getAttribute("style")).toContain("--color-chart-2");
  });

  it("a department bar filters on that department", async () => {
    renderSheet("view=selected&department=Nursing");
    const href = (await screen.findByRole("link", { name: /^ECE: 117/ })).getAttribute("href")!;
    expect(href).toContain("department=ECE");
    expect(href).not.toContain("Nursing");
  });

  it("See full list keeps what the Selected tile used to do", async () => {
    renderSheet("view=selected&department=Nursing");
    const href = (await screen.findByRole("link", { name: "See full list" })).getAttribute("href")!;
    expect(href).toContain("status=Selected");
    expect(href).toContain("department=Nursing");
    expect(href).not.toContain("view=");
  });
});
