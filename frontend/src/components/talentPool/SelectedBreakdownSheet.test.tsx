import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    full_name: `Person ${id}`,
    status: "Selected",
    eligibility: null,
    reference: id % 2 ? "Mam Data" : "Our Data",
    source: id % 2 ? "Faculty Plus" : id === 2 ? "Indeed" : null,
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

function Harness({ search: initialSearch, startOpen, onClose, scope }: { search: string; startOpen: boolean; onClose?: () => void; scope?: "selected" | "all" | "filtered" }) {
  const [deptMode, setDeptMode] = useState<"group" | "raw">("group");
  const [open, setOpen] = useState(startOpen);
  const [search, setSearch] = useState(initialSearch);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <SelectedBreakdownSheet
        open={open}
        scope={scope}
        tab="TEACHING_FINAL"
        deptMode={deptMode}
        currentParams={new URLSearchParams(search)}
        onDeptModeChange={setDeptMode}
        onIncludeInferredChange={(on) => {
          const next = new URLSearchParams(search);
          if (on) next.delete("include_inferred");
          else next.set("include_inferred", "false");
          setSearch(next.toString());
        }}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      />
    </>
  );
}

function renderSheet(search = "view=selected", open = true, onClose?: () => void, scope?: "selected" | "all" | "filtered") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness search={search} startOpen={open} onClose={onClose} scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (title: string) => screen.getByRole("heading", { name: title }).parentElement!.parentElement!.parentElement!;
const bar = (title: string, name: RegExp) => within(card(title)).getByRole("button", { name });
const pickMore = (title: string) => userEvent.click(within(card(title)).getByRole("button", { name: /^Pick more/ }));
const heading = () => screen.getByRole("heading", { name: /candidates/ }).textContent;
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
    expect(screen.getByTestId("selection-box")).toHaveTextContent("Click a bar to show only that data");
  });

  it("the box shows the picked values", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await pickMore("College");
    await userEvent.click(bar("College", /^SCAD: /));
    await userEvent.click(bar("Department", /^ECE: /));
    const box = screen.getByTestId("selection-box");
    expect(box).toHaveTextContent("Your selection:");
    expect(box).toHaveTextContent("College: SSE, SCAD");
    expect(box).toHaveTextContent("Dept: ECE");
  });

  it("the headline tiles count what is left after every filter", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    const tile = (look: string) => screen.getByTestId(`tile-${look}`);
    expect(tile("college")).toHaveTextContent("3Colleges");
    await userEvent.click(bar("College", /^SSE: /));
    expect(tile("gender")).toHaveTextContent("5Selected");
    expect(tile("college")).toHaveTextContent("1College");
    expect(tile("department")).toHaveTextContent("2Departments");
    expect(tile("state")).toHaveTextContent("2States");
  });

  it("Reference and Source filter like the others, and the list carries them", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("Reference", /^Our Data: 5/));
    expect(heading()).toBe("Selected candidates: 5 of 10");
    expect(within(card("Source")).getByText("Recorded for 1 of 5")).toBeInTheDocument();
    await userEvent.click(bar("Source", /^Indeed: 1/));
    expect(heading()).toBe("Selected candidates: 1 of 10");
    const href = fullList();
    expect(href).toContain("source=Our Data".replace(" ", "+"));
    expect(href).toContain("data_source=Indeed");
  });

  it("lists the matching candidates in the panel and pages them", async () => {
    mockedGet.mockResolvedValue(Array.from({ length: 30 }, (_, i) => row(i + 100, { college: i < 27 ? "SSE" : "SCAD" })));
    renderSheet();
    const table = await screen.findByTestId("candidate-table");
    expect(table).toHaveTextContent("Candidates: 30");
    expect(table).toHaveTextContent("Person 100");
    expect(table).not.toHaveTextContent("Person 129");
    await userEvent.click(within(table).getByRole("button", { name: "Next" }));
    expect(table).toHaveTextContent("Person 129");

    await userEvent.click(bar("College", /^SCAD: 3/));
    expect(table).toHaveTextContent("Candidates: 3");
    expect(table).toHaveTextContent("Person 127");
    expect(table).not.toHaveTextContent("Person 100");
    expect(within(table).queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("over every candidate it adds a Status chart and carries the statuses to the list", async () => {
    vi.mocked(talentPoolApi.getAllRows).mockResolvedValue([row(1, { status: "Selected" }), row(2, { status: "Rejected" }), row(3, { status: "Pending" })]);
    renderSheet("view=all", true, undefined, "all");
    await screen.findByRole("heading", { name: "Status" });
    expect(mockedGet).not.toHaveBeenCalled();
    expect(heading()).toBe("All candidates: 3");
    await userEvent.click(bar("Status", /^Rejected: 1/));
    expect(heading()).toBe("All candidates: 1 of 3");
    expect(fullList()).toContain("status=Rejected");
  });

  describe("over one tile's count", () => {
    const everyone = [
      row(1, { status: "Rejected", college: "SSE" }),
      row(2, { status: "Rejected", college: "SCAD" }),
      row(3, { status: "Joined", college: "SSE", eligibility: "With Ph.D" }),
      row(4, { status: "RNR", college: "SSE", eligibility: "With Ph.D" }),
      row(5, { status: "On Hold", college: "SSE" }),
    ];
    beforeEach(() => vi.mocked(talentPoolApi.getAllRows).mockResolvedValue(everyone));

    it("one status: its people only, no Status chart, and the list keeps it", async () => {
      renderSheet("view=filtered&status=Rejected", true, undefined, "filtered");
      await screen.findByRole("heading", { name: "College" });
      expect(heading()).toBe("Rejected candidates: 2");
      expect(screen.queryByRole("heading", { name: "Status" })).not.toBeInTheDocument();
      expect(fullList()).toContain("status=Rejected");
      await userEvent.click(bar("College", /^SSE: 1/));
      expect(heading()).toBe("Rejected candidates: 1 of 2");
      expect(fullList()).toContain("status=Rejected");
      expect(fullList()).toContain("college=SSE");
    });

    it("several statuses: a Status chart to split them", async () => {
      renderSheet("view=filtered&status=RNR&status=On+Hold", true, undefined, "filtered");
      await screen.findByRole("heading", { name: "Status" });
      expect(heading()).toBe("RNR, On Hold candidates: 2");
      await userEvent.click(bar("Status", /^RNR: 1/));
      expect(heading()).toBe("RNR, On Hold candidates: 1 of 2");
      expect(fullList()).toContain("status=RNR");
      expect(fullList()).not.toContain("status=On");
    });

    it("an eligibility: its people across statuses, and the list keeps it", async () => {
      renderSheet("view=filtered&eligibility=With+Ph.D", true, undefined, "filtered");
      await screen.findByRole("heading", { name: "Status" });
      expect(heading()).toBe("With Ph.D candidates: 2");
      expect(fullList().replace("+", " ")).toContain("eligibility=With Ph.D");
    });
  });

  it("has no Status chart for Selected only", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    expect(screen.queryByRole("heading", { name: "Status" })).not.toBeInTheDocument();
  });

  it("says how many values came from resumes", async () => {
    renderSheet();
    expect(await screen.findByText("Recorded for 4 of 10 (3 from sheet \u00b7 1 inferred)")).toBeInTheDocument();
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

  it("test 1: a college bar shows only that data, everywhere", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: 5/));

    expect(heading()).toBe("Selected candidates: 5 of 10");
    expect(bar("College", /^SSE: 5/)).toHaveAttribute("aria-pressed", "true");
    expect(within(card("College")).getByText("Recorded for 5 of 5")).toBeInTheDocument();
    expect(within(card("Department")).getByText("Recorded for 5 of 5")).toBeInTheDocument();
    expect(within(card("Male / Female")).getByText("Recorded for 4 of 5")).toBeInTheDocument();
    expect(within(card("State")).getByText("Recorded for 4 of 5 (3 from sheet \u00b7 1 inferred)")).toBeInTheDocument();
    expect(within(card("Country")).getByText("Recorded for 3 of 5")).toBeInTheDocument();
    expect(bar("Department", /^ECE: 3/)).toBeInTheDocument();
    expect(bar("Department", /^CSE: 2/)).toBeInTheDocument();
    // Other colleges and anything left at 0 are gone, not dimmed.
    expect(within(card("College")).queryByRole("button", { name: /^SCAD/ })).not.toBeInTheDocument();
    expect(within(card("Department")).queryByRole("button", { name: /^Maths/ })).not.toBeInTheDocument();
    expect(bar("Male / Female", /^Male: 2\s*\(50%\)/)).toBeInTheDocument();
    expect(bar("Male / Female", /^Female: 2\s*\(50%\)/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Active filters" })).getByRole("button", { name: /College filter: SSE/ })).toHaveTextContent("College: SSE");
  });

  it("from resumes counts only the picked values in a narrowed chart", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("State", /^Tamil Nadu: /));
    expect(within(card("State")).getByText("Recorded for 2 of 2 (1 from sheet \u00b7 1 inferred)")).toBeInTheDocument();
    await userEvent.click(bar("State", /^Tamil Nadu: /));
    await userEvent.click(bar("State", /^Kerala: /));
    expect(within(card("State")).getByText("Recorded for 2 of 2")).toBeInTheDocument();
  });

  it("test 2: Pick more brings the others back, and a plain click then adds", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SSE: /));
    await pickMore("College");
    expect(bar("College", /^SCAD: 2/)).toHaveAttribute("data-dimmed", "true");
    expect(within(card("College")).getByText("Recorded for 8 of 10")).toBeInTheDocument();

    await userEvent.click(bar("College", /^SCAD: /));
    expect(heading()).toBe("Selected candidates: 7 of 10");
    expect(bar("Department", /^ECE: 4/)).toBeInTheDocument();
    expect(bar("Department", /^Maths: 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /College filter/ })).toHaveTextContent("College: SSE, SCAD");

    await userEvent.click(within(card("College")).getByRole("button", { name: "Show only selected" }));
    expect(within(card("College")).queryByRole("button", { name: /^SCLAS/ })).not.toBeInTheDocument();
    expect(within(card("College")).getByText("Recorded for 7 of 7")).toBeInTheDocument();
  });

  it("Ctrl and Cmd + click still add while the others are showing", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    fireEvent.click(bar("College", /^SSE: /), { ctrlKey: true });
    fireEvent.click(bar("Department", /^ECE: /), { metaKey: true });
    expect(heading()).toBe("Selected candidates: 3 of 10");
    await pickMore("College");
    fireEvent.click(bar("College", /^SCAD: /), { ctrlKey: true });
    fireEvent.click(bar("College", /^SSE: /), { metaKey: true });
    expect(heading()).toBe("Selected candidates: 1 of 10");
  });

  it("Ctrl + click on a Mac arrives as a context menu, and still adds", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    fireEvent.contextMenu(bar("College", /^SSE: /), { ctrlKey: true });
    expect(heading()).toBe("Selected candidates: 5 of 10");
    await pickMore("College");
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
    await pickMore("College");
    await userEvent.click(bar("College", /^SCAD: /));
    await userEvent.click(within(card("College")).getByRole("button", { name: "Show only selected" }));
    await userEvent.click(bar("Department", /^ECE: /));

    expect(heading()).toBe("Selected candidates: 4 of 10");
    expect(bar("College", /^SSE: 3/)).toHaveAttribute("aria-pressed", "true");
    expect(bar("College", /^SCAD: 1/)).toHaveAttribute("aria-pressed", "true");
    expect(within(card("College")).getByText("Recorded for 4 of 4")).toBeInTheDocument();
    expect(within(card("Department")).getByText("Recorded for 4 of 4")).toBeInTheDocument();
    expect(within(card("Department")).queryByRole("button", { name: /^CSE/ })).not.toBeInTheDocument();
    expect(bar("Male / Female", /^Female: 3/)).toBeInTheDocument();
    expect(bar("Male / Female", /^Male: 1/)).toBeInTheDocument();

    await userEvent.click(bar("Department", /^ECE: /));
    expect(heading()).toBe("Selected candidates: 7 of 10");
    expect(bar("Department", /^ECE: 4/)).toHaveAttribute("aria-pressed", "false");
  });

  it("says so when a chart has nothing for the selection", async () => {
    renderSheet();
    await screen.findByRole("heading", { name: "College" });
    await userEvent.click(bar("College", /^SCLAS: /));
    expect(within(card("State")).getByText("Not recorded for this selection.")).toBeInTheDocument();
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
    await pickMore("Department");
    await userEvent.click(bar("Department", /^CSE: /));
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
    await pickMore("College");
    await userEvent.click(bar("College", /^SCAD: /));
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

  describe("inferred values", () => {
    const inferredRows: TalentPoolSelectedRow[] = [
      row(1, { gender: "Male", state: "Tamil Nadu", gender_source: "sheet", state_source: "sheet" }),
      row(2, {
        gender: "Female",
        state: "Tamil Nadu",
        gender_from_resume: true,
        state_from_resume: true,
        gender_source: "resume_honorific",
        gender_evidence: "From honorific 'Ms.' in the resume",
        state_source: "resume_pincode",
        state_evidence: "From PIN code 600077",
      }),
    ];

    it("defaults ON, then sends include_inferred=false when switched off", async () => {
      mockedGet.mockResolvedValue(inferredRows);
      renderSheet();
      await screen.findByTestId("candidate-table");
      expect(mockedGet).toHaveBeenLastCalledWith("TEACHING_FINAL", false, true);
      const toggle = screen.getByRole("switch", { name: "Include inferred values" });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith("TEACHING_FINAL", false, false));
      expect(screen.getByRole("switch", { name: "Include inferred values" })).not.toBeChecked();
    });

    it("starts OFF when the URL says include_inferred=false", async () => {
      mockedGet.mockResolvedValue(inferredRows);
      renderSheet("view=selected&include_inferred=false");
      await screen.findByTestId("candidate-table");
      expect(mockedGet).toHaveBeenLastCalledWith("TEACHING_FINAL", false, false);
      expect(screen.getByRole("switch", { name: "Include inferred values" })).not.toBeChecked();
    });

    it("splits the recorded line into sheet and inferred", async () => {
      mockedGet.mockResolvedValue(inferredRows);
      renderSheet();
      await screen.findByTestId("candidate-table");
      expect(screen.getAllByText(/Recorded for 2 of 2 \(1 from sheet \u00b7 1 inferred\)/).length).toBeGreaterThan(0);
    });

    it("italicises an inferred value with a tooltip and leaves a sheet value plain", async () => {
      mockedGet.mockResolvedValue(inferredRows);
      renderSheet();
      const table = within(await screen.findByTestId("candidate-table"));
      const inferredState = table.getByTitle("From PIN code 600077");
      expect(inferredState.tagName).toBe("I");
      expect(inferredState).toHaveTextContent("Tamil Nadu");
      expect(table.getByTitle("From honorific 'Ms.' in the resume")).toHaveTextContent("Female");
      const sheetRow = table.getByText("Person 1").closest("tr") as HTMLElement;
      expect(within(sheetRow).getByText("Male").tagName).toBe("TD");
      expect(sheetRow.querySelector("i")).toBeNull();
    });
  });
});
