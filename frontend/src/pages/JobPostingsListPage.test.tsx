import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

const SSE: CampusRead = { id: "c-sse", code: "SSE", name: "SSE Campus", is_active: true, created_at: "", updated_at: "" };
const SCAD: CampusRead = { id: "c-scad", code: "SCAD", name: "SCAD Campus", is_active: true, created_at: "", updated_at: "" };

function department(id: string, campusId: string, name: string): DepartmentRead {
  return {
    id,
    campus_id: campusId,
    name,
    code: null,
    supported_categories: [],
    parent_group: null,
    description: null,
    is_active: true,
    created_at: "",
    updated_at: "",
  };
}
const CSE = department("d-cse", "c-sse", "Computer Science");
const MECH = department("d-mech", "c-scad", "Mechanical Engineering");

function makePosting(overrides: Partial<JobPostingRead>): JobPostingRead {
  return {
    id: "jp-1",
    approved_vacancy_id: "av-1",
    campus_id: "c-sse",
    role_category: "TEACHING",
    public_apply_slug: "slug-1",
    published_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    is_active: true,
    position_title: "Assistant Professor",
    department_id: "d-cse",
    requested_count: 1,
    available_count: 1,
    positions_requested: 2,
    positions_filled: 1,
    positions_remaining: 1,
    posting_number: null,
    status: "PUBLISHED",
    ad_title: null,
    ad_body: null,
    apply_deadline: null,
    contact_email: null,
    last_edited_by_id: null,
    last_edited_by_name: null,
    last_edited_at: null,
    is_accepting_applications: true,
    vacancy_request_id: "vr-1",
    vacancy_request_ref: null,
    requisition_number: null,
    campus_code: "SSE",
    campus_name: "SSE Campus",
    department_name: "Computer Science",
    designation_id: null,
    designation_name: null,
    priority: "NORMAL",
    required_by: null,
    summary: null,
    responsibilities: null,
    required_qualification: null,
    required_experience: null,
    required_skills: null,
    preferred_skills: null,
    employment_type: null,
    location_id: null,
    location_label: null,
    salary_min: null,
    salary_max: null,
    ai_generated_at: null,
    poster_headline: null,
    poster_pitch: null,
    poster_bullets: null,
    poster_copy_generated_at: null,
    has_poster_background: false,
    poster_background_enabled: false,
    poster_background_generated_at: null,
    has_role_photo: false,
    role_photo_enabled: false,
    role_photo_generated_at: null,
    created_by_id: null,
    created_by_name: null,
    submitted_for_review_by_id: null,
    submitted_for_review_by_name: null,
    submitted_for_review_at: null,
    approved_by_id: null,
    approved_by_name: null,
    approved_at: null,
    published_by_id: null,
    published_by_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ACTIVE_POSTING = makePosting({});
const CLOSED_POSTING = makePosting({
  id: "jp-2",
  approved_vacancy_id: "av-2",
  campus_id: "c-scad",
  role_category: "NON_TEACHING",
  public_apply_slug: "slug-2",
  published_at: "2026-01-02T00:00:00Z",
  closed_at: "2026-01-10T00:00:00Z",
  is_active: false,
  position_title: "Lab Technician",
  department_id: "d-mech",
  status: "CLOSED",
});
const DRAFT_POSTING = makePosting({
  id: "jp-3",
  public_apply_slug: "slug-3",
  published_at: null,
  is_active: false,
  position_title: "Associate Professor",
  status: "DRAFT",
  positions_requested: 4,
  positions_filled: 0,
  positions_remaining: 4,
});

function mockData(postings: JobPostingRead[]) {
  mockedListJobPostings.mockResolvedValue(postings);
  mockedListCampuses.mockResolvedValue([SSE, SCAD]);
  mockedListDepartments.mockResolvedValue([CSE, MECH]);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/job-postings"]}>
        <Routes>
          <Route path="/job-postings" element={<JobPostingsListPage />} />
          <Route path="/job-postings/:id" element={<p>Posting detail page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JobPostingsListPage", () => {
  it("renders job postings with position title, department and campus", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
    expect(screen.getByText("Mechanical Engineering")).toBeInTheDocument();
    expect(screen.getByText("SCAD")).toBeInTheDocument();
  });

  it("shows Requested, Filled and Remaining from the backend's derived counts", async () => {
    mockData([ACTIVE_POSTING]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    const row = screen.getByText("Assistant Professor").closest("tr");
    if (!row) throw new Error("row not found");
    const cells = within(row).getAllByRole("cell");
    // Number, Job Position, Department, Campus, Requested, Filled, Remaining, Status, Published.
    expect(screen.getByRole("columnheader", { name: "Filled" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Available" })).not.toBeInTheDocument();
    expect(cells[4]).toHaveTextContent("2");
    expect(cells[5]).toHaveTextContent("1");
    expect(cells[6]).toHaveTextContent("1");
  });

  it("shows a draft as not yet published, and narrows to drafts by status", async () => {
    mockData([ACTIVE_POSTING, DRAFT_POSTING]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Associate Professor")).toBeInTheDocument());
    const draftRow = screen.getByText("Associate Professor").closest("tr");
    if (!draftRow) throw new Error("row not found");
    expect(within(draftRow).getByText("Draft")).toBeInTheDocument();
    expect(within(draftRow).getByText("Not yet")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Draft" }));
    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Associate Professor")).toBeInTheDocument();
  });

  it("opens a posting when its row is clicked", async () => {
    mockData([ACTIVE_POSTING]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Computer Science")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Computer Science"));
    expect(await screen.findByText("Posting detail page")).toBeInTheDocument();
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

    await userEvent.type(screen.getByPlaceholderText("Search by title or posting number"), "lab");

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Lab Technician")).toBeInTheDocument();
  });

  it("shows a filters-specific empty state when filters narrow a non-empty list to zero", async () => {
    mockData([ACTIVE_POSTING, CLOSED_POSTING]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Assistant Professor")).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText("Search by title or posting number"), "nonexistent");

    expect(await screen.findByText("No job postings match these filters.")).toBeInTheDocument();
  });
});
