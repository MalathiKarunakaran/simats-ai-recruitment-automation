import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/publicCareers";
import { PublicCareersPage } from "@/pages/PublicCareersPage";

vi.mock("@/api/publicCareers");

const mockedList = vi.mocked(api.listPublicPostings);

const POSTINGS: api.PublicJobPostingSummary[] = [
  {
    posting_number: "JP-2026-000001",
    public_apply_slug: "sse-assistant-professor-ab12cd34",
    title: "Assistant Professor (CSE)",
    campus_code: "SSE",
    campus_name: "Saveetha School of Engineering",
    department_name: "CSE",
    role_category: "TEACHING",
    employment_type: "FULL_TIME",
    qualification: "Ph.D. in Computer Science",
    experience_required: "3+ years",
    positions_open: 2,
    apply_deadline: "2026-09-30",
    published_at: "2026-09-01T00:00:00Z",
  },
  {
    posting_number: "JP-2026-000002",
    public_apply_slug: "sclas-lab-assistant-ef56ab78",
    title: "Lab Assistant",
    campus_code: "SCLAS",
    campus_name: "Saveetha College of Liberal Arts and Sciences",
    department_name: "Physics",
    role_category: "NON_TEACHING",
    employment_type: "CONTRACT",
    qualification: "B.Sc. Physics",
    experience_required: "1 year",
    positions_open: 1,
    apply_deadline: null,
    published_at: "2026-09-02T00:00:00Z",
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A MemoryRouter only because the cards are <Link>s. No auth provider and
  // no AppShell: this page renders outside both.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublicCareersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PublicCareersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue({ items: POSTINGS, total: POSTINGS.length });
  });

  it("lists every open posting as a card linking to its own page", async () => {
    renderPage();

    const first = await screen.findByRole("link", { name: "Assistant Professor (CSE) at SSE" });
    expect(first).toHaveAttribute("href", "/careers/sse-assistant-professor-ab12cd34");
    expect(screen.getByRole("link", { name: "Lab Assistant at SCLAS" })).toHaveAttribute(
      "href",
      "/careers/sclas-lab-assistant-ef56ab78",
    );
    expect(screen.getByText("2 openings")).toBeInTheDocument();
  });

  it("renders the facts a candidate decides on, in plain words", async () => {
    renderPage();

    await screen.findByText("Assistant Professor (CSE)");
    expect(screen.getByText("SSE · CSE")).toBeInTheDocument();
    expect(screen.getByText("Full Time")).toBeInTheDocument();
    expect(screen.getByText("2 positions")).toBeInTheDocument();
    expect(screen.getByText("1 position")).toBeInTheDocument();
    expect(screen.getByText("Apply by 30 Sept 2026")).toBeInTheDocument();
    expect(screen.getByText("Open until filled")).toBeInTheDocument();
    expect(screen.getByText("Teaching")).toBeInTheDocument();
    expect(screen.getByText("Non-Teaching")).toBeInTheDocument();
  });

  it("offers only the campuses that currently have an opening", async () => {
    renderPage();
    await screen.findByText("Assistant Professor (CSE)");

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));

    expect(await screen.findByRole("option", { name: /^SSE/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^SCLAS/ })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3); // All + two
  });

  it("filters server-side when a campus or category is picked", async () => {
    renderPage();
    await screen.findByText("Assistant Professor (CSE)");

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: /^SCLAS/ }));
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ campus: "SCLAS", role_category: undefined })),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Category" }));
    await userEvent.click(await screen.findByRole("option", { name: "Teaching" }));
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ campus: "SCLAS", role_category: "TEACHING" })),
    );
  });

  it("passes the search text through as q", async () => {
    renderPage();
    await screen.findByText("Assistant Professor (CSE)");

    await userEvent.type(screen.getByLabelText("Search"), "Lab");

    await waitFor(() => expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ q: "Lab" })));
  });

  it("distinguishes 'nothing open' from 'filters matched nothing'", async () => {
    mockedList.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText(/no openings at the moment/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search"), "zzz");
    expect(await screen.findByText("No openings match these filters.")).toBeInTheDocument();
  });

  it("says so when the list cannot be loaded", async () => {
    mockedList.mockRejectedValue(new Error("boom"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
