import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as departmentsApi from "@/api/departments";
import * as jobPostingsApi from "@/api/jobPostings";
import type { CampusRead, DepartmentRead, JobPostingRead } from "@/api/types";
import { JobPostingsListPage } from "@/pages/JobPostingsListPage";

vi.mock("@/api/campuses");
vi.mock("@/api/departments");
vi.mock("@/api/jobPostings");

const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListJobPostings = vi.mocked(jobPostingsApi.listJobPostings);

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "SSE Campus",
  is_active: true,
  created_at: "",
  updated_at: "",
};
const SCAD: CampusRead = {
  id: "c-scad",
  code: "SCAD",
  name: "SCAD Campus",
  is_active: true,
  created_at: "",
  updated_at: "",
};

const CSE: DepartmentRead = {
  id: "d-cse",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
  created_at: "",
  updated_at: "",
};
const MECH: DepartmentRead = {
  id: "d-mech",
  campus_id: "c-scad",
  name: "Mechanical Engineering",
  code: null,
  category: null,
  parent_group: null,
  is_active: true,
  created_at: "",
  updated_at: "",
};

const ACTIVE_POSTING: JobPostingRead = {
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  public_apply_slug: "slug-1",
  published_at: "2026-01-01T00:00:00Z",
  closed_at: null,
  is_active: true,
  position_title: "Assistant Professor",
  department_id: "d-cse",
  requested_count: 1,
  available_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const CLOSED_POSTING: JobPostingRead = {
  id: "jp-2",
  approved_vacancy_id: "av-2",
  campus_id: "c-scad",
  public_apply_slug: "slug-2",
  published_at: "2026-01-02T00:00:00Z",
  closed_at: "2026-01-10T00:00:00Z",
  is_active: false,
  position_title: "Lab Technician",
  department_id: "d-mech",
  requested_count: 0,
  available_count: 1,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function mockData(postings: JobPostingRead[]) {
  mockedListJobPostings.mockResolvedValue(postings);
  mockedListCampuses.mockResolvedValue([SSE, SCAD]);
  mockedListDepartments.mockResolvedValue([CSE, MECH]);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobPostingsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JobPostingsListPage", () => {
  it("renders job postings with position title, department, campus, and requested/available counts", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
    expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
    expect(screen.getByText("SCAD")).toBeInTheDocument();
  });

  it("shows Requested (still needed) and Available (already filled) as distinct, correctly-ordered columns", async () => {
    // ACTIVE_POSTING: requested_count=1 (1 slot still open), available_count=1
    // (1 candidate already joined) -- out of a 2-slot vacancy, matching what
    // onboarding an employee is expected to do: requested goes down,
    // available goes up.
    mockData([ACTIVE_POSTING]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    const row = screen.getByText("Assistant Professor").closest("tr");
    if (!row) throw new Error("row not found");
    const cells = within(row).getAllByRole("cell");
    // Job Position, Department, Campus, Requested, Available, Status, Published.
    expect(cells[3]).toHaveTextContent("1");
    expect(cells[4]).toHaveTextContent("1");
  });

  it("shows the empty-scope message when there are no postings at all", async () => {
    mockData([]);

    renderPage();

    expect(await screen.findByText("No job postings in this scope yet.")).toBeInTheDocument();
  });

  it("narrows the list client-side by active/closed status", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Closed" }));

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
  });

  it("narrows the list client-side by campus", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Campus filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
  });

  it("narrows the list client-side by position-title search", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by position title"), "lab");

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by position title"), "nonexistent");

    expect(await screen.findByText("No job postings match these filters.")).toBeInTheDocument();
  });
});
