import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as talentPoolApi from "@/api/talentPool";
import type { TalentPoolSelectedRow } from "@/api/types";
import { SelectedBreakdownSheet } from "@/components/talentPool/SelectedBreakdownSheet";

vi.mock("@/api/talentPool");
const mockedGet = vi.mocked(talentPoolApi.getSelectedRows);

function row(id: number, over: Partial<TalentPoolSelectedRow>): TalentPoolSelectedRow {
  return {
    id: String(id),
    gender: null,
    college: null,
    country: null,
    state: null,
    dept_raw: null,
    dept_group: null,
    gender_from_resume: false,
    country_from_resume: false,
    state_from_resume: false,
    ...over,
  };
}

// Ten candidates: SSE 5 (ECE 3, CSE 2), SCAD 2 (ECE 1, Maths 1), SCLAS 1 (CSE), 2 with no college.
const rows: TalentPoolSelectedRow[] = [
  row(1, { college: "SSE", dept_group: "ECE", dept_raw: "ECE", gender: "Male", state: "Tamil Nadu", country: "India" }),
  row(2, { college: "SSE", dept_group: "ECE", dept_raw: "E.C.E", gender: "Female", state: "Tamil Nadu", country: "India", state_from_resume: true }),
  row(3, { college: "SSE", dept_group: "ECE", dept_raw: "ECE", gender: "Female", state: "Kerala", country: "India" }),
  row(4, { college: "SSE", dept_group: "CSE", dept_raw: "IT", gender: "Male" }),
  row(5, { college: "SSE", dept_group: "CSE", dept_raw: "MCA", state: "Kerala" }),
  row(6, { college: "SCAD", dept_group: "ECE", dept_raw: "ECE", gender: "Female", country: "India" }),
  row(7, { college: "SCAD", dept_group: "Maths", dept_raw: "Maths", gender: "Male" }),
  row(8, { college: "SCLAS", dept_group: "CSE", dept_raw: "IT", gender: "Male" }),
  row(9, { dept_group: "Maths", dept_raw: "Maths" }),
  row(10, { gender: "Female" }),
];

function Harness({ search, startOpen, onClose }: { search: string; startOpen: boolean; onClose?: () => void }) {
  const [deptMode, setDeptMode] = useState<"group" | "raw">("group");
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <SelectedBreakdownSheet
        open={open}
        tab="TEACHING_FINAL"
        deptMode={deptMode}
        currentParams={new URLSearchParams(search)}
        onDeptModeChange={setDeptMode}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      />
    </>
  );
}

function renderSheet(search = "view=selected", open = true, onClose?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness search={search} startOpen={open} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (title: string) => screen.getByRole("heading", { name: title }).parentElement!.parentElement!.parentElement!;
const bar = (title: string, name: RegExp) => within(card(title)).getByRole("button", { name });
const heading = () => screen.getByRole("heading", { name: /Selected candidates/ }).textContent;
const fullList = () => decodeURIComponent(screen.getByRole("link", { name: "See full list" }).getAttribute("href")!);

describe("SelectedBreakdownSheet", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue(rows);
  });

  it("fetches nothing until it is opened", () => {
    renderSheet("", false);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("says how much of the total each card covers, with no filter", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    expect(within(card("College")).getByText("Recorded for 8 of 10")).toBeInTheDocument();
    expect(heading()).toBe("Selected candidates: 10");
    expect(within(card("Department")).getByText("Recorded for 9 of 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeDisabled();
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
    expect(screen.getByTestId("selection-box")).toHaveTextContent("Click a bar to filter");
  });

  it("the box shows the picked values", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    fireEvent.click(bar("College", /^SCAD: /), { ctrlKey: true });
    await userEvent.click(bar("Department", /^ECE: /));
    const box = screen.getByTestId("selection-box");
    expect(box).toHaveTextContent("Your selection:");
    expect(box).toHaveTextContent("College: SSE, SCAD");
    expect(box).toHaveTextContent("Dept: ECE");
  });

  it("says how many values came from resumes", async () => {
    renderSheet();
    expect(await screen.findByText("Recorded for 4 of 10 (1 from resumes)")).toBeInTheDocument();
  });

  it("names the sheet column to fill when a card has no data", async () => {
    mockedGet.mockResolvedValue(rows.map((item) => ({ ...item, country: null })));
    renderSheet();
    expect(await screen.findByText("Not recorded yet. Fill the Country column in the Final sheet.")).toBeInTheDocument();
  });

  it("fetches once however many bars are clicked", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await userEvent.click(bar("Department", /^ECE: /));
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("test 1: a college bar filters everything else", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: 5/));

    expect(heading()).toBe("Selected candidates: 5 of 10");
    expect(bar("College", /^SSE: 5/)).toHaveAttribute("aria-pressed", "true");
    expect(within(card("Department")).getByText("Recorded for 5 of 5")).toBeInTheDocument();
    expect(within(card("Male / Female")).getByText("Recorded for 4 of 5")).toBeInTheDocument();
    expect(within(card("State")).getByText("Recorded for 4 of 5 (1 from resumes)")).toBeInTheDocument();
    expect(within(card("Country")).getByText("Recorded for 3 of 5")).toBeInTheDocument();
    expect(bar("Department", /^ECE: 3/)).toBeInTheDocument();
    expect(bar("Department", /^CSE: 2/)).toBeInTheDocument();
    // The clicked chart still shows every college, counted without its own pick.
    expect(within(card("College")).getByText("Recorded for 8 of 10")).toBeInTheDocument();
    expect(bar("College", /^SCAD: 2/)).toHaveAttribute("data-dimmed", "true");
    expect(bar("College", /^SSE: 5/)).toHaveAttribute("data-dimmed", "false");
    // A bar that drops to 0 stays, shows 0 and is dimmed.
    expect(bar("Department", /^Maths: 0/)).toHaveAttribute("data-dimmed", "true");
    // The share bar recalculates its numbers and percentages.
    expect(bar("Male / Female", /^Male: 2\s*\(50%\)/)).toBeInTheDocument();
    expect(bar("Male / Female", /^Female: 2\s*\(50%\)/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Active filters" })).getByRole("button", { name: /College filter: SSE/ })).toHaveTextContent("College: SSE");
  });

  it("test 2: Ctrl-click adds a second college, Cmd too", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    fireEvent.click(bar("College", /^SCAD: /), { ctrlKey: true });
    expect(heading()).toBe("Selected candidates: 7 of 10");
    expect(bar("Department", /^ECE: 4/)).toBeInTheDocument();
    expect(bar("Department", /^Maths: 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /College filter/ })).toHaveTextContent("College: SSE, SCAD");

    fireEvent.click(bar("College", /^SSE: /), { metaKey: true });
    expect(heading()).toBe("Selected candidates: 2 of 10");
  });

  it("Ctrl + click on a Mac arrives as a context menu, and still adds", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    fireEvent.contextMenu(bar("College", /^SCAD: /), { ctrlKey: true });
    expect(heading()).toBe("Selected candidates: 7 of 10");
    // A plain right-click is left to the browser.
    fireEvent.contextMenu(bar("College", /^SCLAS: /));
    expect(heading()).toBe("Selected candidates: 7 of 10");
  });

  it("tests 3 and 4: a department narrows further, and clicking it again goes back", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    fireEvent.click(bar("College", /^SCAD: /), { ctrlKey: true });
    await userEvent.click(bar("Department", /^ECE: /));

    expect(heading()).toBe("Selected candidates: 4 of 10");
    // College shows all colleges with ECE counts; SSE and SCAD stay highlighted.
    expect(bar("College", /^SSE: 3/)).toHaveAttribute("aria-pressed", "true");
    expect(bar("College", /^SCAD: 1/)).toHaveAttribute("aria-pressed", "true");
    expect(bar("College", /^SCLAS: 0/)).toHaveAttribute("data-dimmed", "true");
    expect(within(card("College")).getByText("Recorded for 4 of 4")).toBeInTheDocument();
    // Department counts SSE and SCAD only, and is not narrowed by its own pick.
    expect(bar("Department", /^CSE: 2/)).toHaveAttribute("data-dimmed", "true");
    expect(bar("Male / Female", /^Female: 3/)).toBeInTheDocument();
    expect(bar("Male / Female", /^Male: 1/)).toBeInTheDocument();

    await userEvent.click(bar("Department", /^ECE: /));
    expect(heading()).toBe("Selected candidates: 7 of 10");
    expect(bar("Department", /^ECE: 4/)).toHaveAttribute("aria-pressed", "false");
  });

  it("test 5: Clear selection takes everything off", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(heading()).toBe("Selected candidates: 10");
    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
  });

  it("test 5: Esc clears the filters first, then closes the panel", async () => {
    const onClose = vi.fn();
    renderSheet("view=selected", true, onClose);
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));

    await userEvent.keyboard("{Escape}");
    expect(heading()).toBe("Selected candidates: 10");
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("test 6: switching department view clears the department filter only", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await userEvent.click(bar("Department", /^ECE: /));
    expect(heading()).toBe("Selected candidates: 3 of 10");

    await userEvent.click(screen.getByRole("button", { name: "As in sheet" }));

    expect(heading()).toBe("Selected candidates: 5 of 10");
    expect(screen.getByRole("button", { name: /College filter/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dept filter/ })).not.toBeInTheDocument();
    expect(bar("Department", /^IT: 1/)).toBeInTheDocument();
    expect(bar("Department", /^E\.C\.E: 1/)).toBeInTheDocument();
  });

  it("filters the raw value in As in sheet", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(screen.getByRole("button", { name: "As in sheet" }));
    await userEvent.click(bar("Department", /^IT: /));
    expect(heading()).toBe("Selected candidates: 2 of 10");
    expect(fullList()).toContain("department=IT");
    expect(fullList()).toContain("dept_mode=raw");
  });

  it("a chip removes its whole chart's filter", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("Department", /^ECE: /));
    fireEvent.click(bar("Department", /^CSE: /), { ctrlKey: true });
    await userEvent.click(bar("College", /^SSE: /));
    const chip = screen.getByRole("button", { name: /Dept filter/ });
    expect(chip).toHaveTextContent("Dept: ECE, CSE");
    await userEvent.click(chip);
    expect(heading()).toBe("Selected candidates: 5 of 10");
  });

  it("closing the panel resets the filters", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("reopen"));
    await screen.findByRole("heading", { name: "College" });
    expect(heading()).toBe("Selected candidates: 10");
  });

  it("bars work from the keyboard", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    const sse = bar("College", /^SSE: /);
    sse.focus();
    await userEvent.keyboard("{Enter}");
    expect(heading()).toBe("Selected candidates: 5 of 10");
    await userEvent.keyboard(" ");
    expect(heading()).toBe("Selected candidates: 10");
  });

  it("opens with focus on the panel itself, so nothing scrolls it down", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("colours Male and Female by name, whichever is larger", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    expect(bar("Male / Female", /^Female: /).querySelector("span")!.getAttribute("style")).toContain("--color-chart-2");
  });

  it("See full list carries the filters and drops an earlier narrowing", async () => {
    renderSheet("view=selected&department=Nursing&q=asha");
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    fireEvent.click(bar("College", /^SCAD: /), { ctrlKey: true });
    await userEvent.click(bar("Department", /^ECE: /));

    const href = fullList();
    expect(href).toContain("status=Selected");
    expect(href).toContain("college=SSE");
    expect(href).toContain("college=SCAD");
    expect(href).toContain("department=ECE");
    expect(href).toContain("dept_mode=group");
    expect(href).not.toContain("Nursing");
    expect(href).not.toContain("q=asha");
    expect(href).not.toContain("view=");
    expect(href.endsWith("#register")).toBe(true);
  });

  it("See full list with no filter keeps what the Selected tile used to do", async () => {
    renderSheet("view=selected&department=Nursing");
    await screen.findByRole("heading", { name: "College" });
    const href = fullList();
    expect(href).toContain("status=Selected");
    expect(href).toContain("department=Nursing");
    expect(href).not.toContain("view=");
  });
});
