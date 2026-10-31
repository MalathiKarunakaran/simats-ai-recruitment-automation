import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/joiningRecords";
import type { DepartmentsSummary, FacultyRead, UnmatchedDepartmentRow } from "@/api/joiningRecords";
import { NewDepartmentsPage } from "@/pages/NewDepartmentsPage";

vi.mock("@/api/joiningRecords", async () => {
  const actual = await vi.importActual<typeof import("@/api/joiningRecords")>("@/api/joiningRecords");
  return { ...actual, getDepartmentsSummary: vi.fn(), listFaculty: vi.fn() };
});

const mockedSummary = vi.mocked(api.getDepartmentsSummary);
const mockedList = vi.mocked(api.listFaculty);

function summary(): DepartmentsSummary {
  return {
    departments: [
      {
        id: "d-1",
        name: "Robotics",
        notes: "Top Dept",
        count: 3,
        count_raw: "3",
        additional_count: 1,
        additional_count_raw: "1",
        approved_total: 4,
        members: 4,
        active: 3,
        active_additional: 1,
        left: 1,
        on_leave: 0,
        hods: ["Dr Robo Head"],
        gap: 1,
        is_active: true,
        approved: true,
      },
    ],
    unmatched: [
      unmatched("Not set", { members: 1, active: 1 }),
      unmatched("Additive Manufacuring Engineering", {
        members: 4,
        active: 3,
        active_additional: 1,
        left: 1,
        on_leave: 0,
        hods: ["Dr Additive"],
      }),
    ],
    faculty_total: 9,
    unmatched_total: 5,
    last_sync_at: "2026-10-31T04:00:00Z",
  };
}

function unmatched(name: string, counts: Partial<UnmatchedDepartmentRow>): UnmatchedDepartmentRow {
  return {
    name,
    members: 0,
    active: 0,
    active_additional: 0,
    left: 0,
    on_leave: 0,
    hods: [],
    ...counts,
    approved: false,
    count: null,
    additional_count: null,
    approved_total: null,
    gap: null,
  };
}

function faculty(overrides: Partial<FacultyRead> = {}): FacultyRead {
  return {
    id: "f-1",
    bio_id: "F1",
    full_name: "Dr Robo Head",
    dept_raw: "robotics ",
    new_department_id: "d-1",
    department_name: "Robotics",
    role: "HOD",
    remark_raw: "HoD",
    status_raw: null,
    is_additional: false,
    top_dept: false,
    top25_raw: null,
    employment_state: null,
    parent_dept_note: null,
    sheet_joinee_id: "j-1",
    joinee_name: "Anitha R",
    joinee_designation: "Professor",
    is_active: true,
    sheet_row_number: 2,
    ...overrides,
  };
}

function renderPage(path = "/new-departments") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <NewDepartmentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSummary.mockResolvedValue(summary());
  mockedList.mockResolvedValue({ items: [faculty()], total: 1, limit: 25, offset: 0 });
});

describe("NewDepartmentsPage", () => {
  it("shows approved, additional, active, gap and HOD, every non-zero count a link", async () => {
    renderPage();
    const table = await screen.findByTestId("department-table");
    const row = within(table).getByRole("link", { name: "Robotics" }).closest("tr")!;
    expect(within(row).getByText("Dr Robo Head")).toBeInTheDocument();
    expect(within(row).getByText("Top Dept")).toBeInTheDocument();
    const p = "/new-departments";
    expect(within(row).getByRole("link", { name: "Robotics" })).toHaveAttribute("href", `${p}?department=Robotics#list`);
    expect(within(row).getByRole("link", { name: "Robotics: 3 active" })).toHaveAttribute(
      "href",
      `${p}?department=Robotics&state=active#list`,
    );
    expect(within(row).getByRole("link", { name: "Robotics: 1 active additional" })).toHaveAttribute(
      "href",
      `${p}?department=Robotics&state=active&additional=true#list`,
    );
    expect(within(row).getByRole("link", { name: "Robotics: 1 left" })).toHaveAttribute(
      "href",
      `${p}?department=Robotics&state=LEFT#list`,
    );
    // on_leave is 0: nothing to open, so not a link.
    expect(within(row).queryByRole("link", { name: /on leave/ })).not.toBeInTheDocument();
  });

  it("lists every department in one table: approved first, then Faculty-tab-only names by name", async () => {
    renderPage();
    const table = await screen.findByTestId("department-table");
    expect(screen.getByTestId("department-counts")).toHaveTextContent(
      "3 departments · 1 approved · 2 only in the Faculty tab",
    );
    const names = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("link")[0].textContent);
    expect(names).toEqual(["Robotics", "Additive Manufacuring Engineering", "Not set"]);
    expect(screen.queryByTestId("unmatched-departments")).not.toBeInTheDocument();

    const approvedRow = within(table).getByRole("link", { name: "Robotics" }).closest("tr")!;
    expect(within(approvedRow).queryByText("Not in Approved_Depts")).not.toBeInTheDocument();
  });

  it("a Faculty-tab-only row has the same counts as links, with — for approved, additional and gap", async () => {
    renderPage();
    const table = await screen.findByTestId("department-table");
    const name = "Additive Manufacuring Engineering";
    const row = within(table).getByRole("link", { name }).closest("tr")!;
    expect(within(row).getByText("Not in Approved_Depts")).toBeInTheDocument();
    expect(within(row).getByText("Dr Additive")).toBeInTheDocument();
    const cells = within(row).getAllByRole("cell");
    // Approved, Additional, Gap.
    expect([cells[1], cells[2], cells[7]].map((c) => c.textContent)).toEqual(["—", "—", "—"]);

    const p = "/new-departments?department=Additive+Manufacuring+Engineering";
    const m = "matched=false#list";
    expect(within(row).getByRole("link", { name })).toHaveAttribute("href", `${p}&${m}`);
    expect(within(row).getByRole("link", { name: `${name}: 3 active` })).toHaveAttribute(
      "href",
      `${p}&state=active&${m}`,
    );
    expect(within(row).getByRole("link", { name: `${name}: 1 active additional` })).toHaveAttribute(
      "href",
      `${p}&state=active&additional=true&${m}`,
    );
    expect(within(row).getByRole("link", { name: `${name}: 1 left` })).toHaveAttribute("href", `${p}&state=LEFT&${m}`);
    expect(within(row).queryByRole("link", { name: /on leave/ })).not.toBeInTheDocument();

    const notSet = within(table).getByRole("link", { name: "Not set" });
    expect(notSet).toHaveAttribute("href", "/new-departments?department=Not+set&matched=false#list");
    expect(screen.getByRole("link", { name: /5 not matched/ })).toHaveAttribute(
      "href",
      "/new-departments?matched=false#list",
    );
  });

  it("clicking a department lists its faculty with role, additional, state, Bio ID and linked joiner", async () => {
    renderPage("/new-departments?department=Robotics#list");
    const table = await screen.findByTestId("faculty-table");
    await within(table).findByText("Dr Robo Head");
    expect(within(table).getByText("Bio ID F1")).toBeInTheDocument();
    expect(within(table).getByText("HOD")).toBeInTheDocument();
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("Anitha R")).toBeInTheDocument();
    expect(within(table).getByText("as typed: robotics")).toBeInTheDocument();
    expect(screen.getByTestId("joining-active-filters")).toHaveTextContent("Department: Robotics");
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ department: "Robotics" }));
  });

  it("passes the boolean filters through", async () => {
    renderPage("/new-departments?department=Robotics&state=active&additional=true");
    const line = await screen.findByTestId("joining-active-filters");
    expect(line).toHaveTextContent("Department: Robotics · Active (not left) · Additional faculty");
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ department: "Robotics", state: "active", additional: true }),
    );
  });

  it("a fresh load of a #list link scrolls once the list has loaded", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderPage("/new-departments?department=Robotics#list");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById("list"));
    scroll.mockRestore();
  });
});
