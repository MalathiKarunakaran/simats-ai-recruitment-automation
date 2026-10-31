import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/joiningRecords";
import type { DepartmentsSummary, FacultyRead } from "@/api/joiningRecords";
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
      },
    ],
    unmatched: [
      { name: "Additive Manufacuring Engineering", members: 2 },
      { name: "Not set", members: 1 },
    ],
    faculty_total: 7,
    unmatched_total: 3,
    last_sync_at: "2026-10-31T04:00:00Z",
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

  it("lists unmatched department names below, each a link", async () => {
    renderPage();
    const list = await screen.findByTestId("unmatched-departments");
    expect(within(list).getByRole("link", { name: "Additive Manufacuring Engineering" })).toHaveAttribute(
      "href",
      "/new-departments?department=Additive+Manufacuring+Engineering#list",
    );
    expect(within(list).getByRole("link", { name: "Not set" })).toHaveAttribute(
      "href",
      "/new-departments?department=Not+set#list",
    );
    expect(screen.getByRole("link", { name: /3 not matched/ })).toHaveAttribute(
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
