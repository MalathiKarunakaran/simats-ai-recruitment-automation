import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as api from "@/api/publicCareers";
import { PublicJobPostingPage } from "@/pages/PublicJobPostingPage";

vi.mock("@/api/publicCareers");

const mockedGet = vi.mocked(api.getPublicPosting);
const mockedApply = vi.mocked(api.applyToPublicPosting);

const SLUG = "sse-assistant-professor-ab12cd34";

const POSTING: api.PublicJobPostingDetail = {
  posting_number: "JP-2026-000001",
  public_apply_slug: SLUG,
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
  ad_body: "Teach undergraduate courses.\nPublish in indexed journals.",
  contact_email: "hr@example.edu",
  status: "PUBLISHED",
  is_accepting_applications: true,
};

function renderPage(slug = SLUG) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/careers/${slug}`]}>
        <Routes>
          <Route path="/careers/:slug" element={<PublicJobPostingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function field(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp("^" + name + "\\s*\\*?$"));
}

function submitButton() {
  return screen.getByRole("button", { name: "Submit application" });
}

const PDF = new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" });

async function fillValidForm() {
  await userEvent.type(field("Full name"), "Asha Candidate");
  await userEvent.type(field("Email"), "asha@example.com");
  await userEvent.type(screen.getByLabelText("Mobile (optional)"), "9876543210");
  await userEvent.upload(field("Resume \\(PDF\\)"), PDF);
}

describe("PublicJobPostingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue(POSTING);
  });

  it("shows the posting's facts, the ad body and the contact", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Assistant Professor (CSE)" })).toBeInTheDocument();
    expect(screen.getByText(/JP-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText("Saveetha School of Engineering (SSE) · CSE")).toBeInTheDocument();
    expect(screen.getByText("Ph.D. in Computer Science")).toBeInTheDocument();
    expect(screen.getByText("3+ years · 2 positions")).toBeInTheDocument();
    expect(screen.getByText(/^30 Sept? 2026$/)).toBeInTheDocument(); // "Sep"/"Sept" differs by ICU version
    expect(screen.getByText(/Teach undergraduate courses/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "hr@example.edu" })).toHaveAttribute("href", "mailto:hr@example.edu");
    expect(mockedGet).toHaveBeenCalledWith(SLUG);
  });

  it("keeps Submit disabled until name, email and a PDF are provided", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });

    expect(submitButton()).toBeDisabled();
    await userEvent.type(field("Full name"), "Asha Candidate");
    await userEvent.type(field("Email"), "asha@example.com");
    expect(submitButton()).toBeDisabled(); // no resume yet

    await userEvent.upload(field("Resume \\(PDF\\)"), PDF);
    expect(submitButton()).toBeEnabled();
  });

  it("refuses a non-PDF resume locally", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });
    await userEvent.type(field("Full name"), "Asha Candidate");
    await userEvent.type(field("Email"), "asha@example.com");

    const input = field("Resume \\(PDF\\)");
    await userEvent.upload(input, new File(["hi"], "resume.docx", { type: "application/msword" }), {
      applyAccept: false,
    });

    expect(screen.getByText("Please upload your resume as a PDF.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("flags a bad mobile number but leaves it optional", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });
    await userEvent.type(field("Full name"), "Asha Candidate");
    await userEvent.type(field("Email"), "asha@example.com");
    await userEvent.upload(field("Resume \\(PDF\\)"), PDF);

    await userEvent.type(screen.getByLabelText("Mobile (optional)"), "123");
    expect(screen.getByText(/valid 10-digit/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Mobile (optional)"));
    expect(submitButton()).toBeEnabled();
  });

  it("submits the form with the empty honeypot and shows the confirmation", async () => {
    mockedApply.mockResolvedValue({
      posting_number: "JP-2026-000001",
      title: "Assistant Professor (CSE)",
      applicant_name: "Asha Candidate",
      applied_at: "2026-09-07T10:00:00Z",
    });
    renderPage();
    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });
    await fillValidForm();

    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(mockedApply).toHaveBeenCalledWith(SLUG, {
        full_name: "Asha Candidate",
        email: "asha@example.com",
        phone_number: "9876543210",
        resume: PDF,
        website: "",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Application received" })).toBeInTheDocument();
    expect(screen.getByText("JP-2026-000001")).toBeInTheDocument();
    expect(screen.getByText(/Thank you, Asha Candidate/)).toBeInTheDocument();
    // The form is gone; nothing invites a second submission.
    expect(screen.queryByRole("button", { name: "Submit application" })).not.toBeInTheDocument();
  });

  it("shows the server's own refusal and keeps the form filled", async () => {
    mockedApply.mockRejectedValue(new ApiError(409, "An application from this email address already exists for this posting"));
    renderPage();
    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });
    await fillValidForm();

    await userEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists for this posting");
    expect(field("Full name")).toHaveValue("Asha Candidate");
    expect(field("Email")).toHaveValue("asha@example.com");
  });

  it("hides the form and says so when the posting has closed", async () => {
    mockedGet.mockResolvedValue({ ...POSTING, status: "CLOSED", is_accepting_applications: false });
    renderPage();

    await screen.findByRole("heading", { name: "Assistant Professor (CSE)" });
    expect(screen.getAllByText("No longer accepting applications").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Submit application" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the current openings." })).toHaveAttribute("href", "/careers");
  });

  it("explains an unknown slug instead of a blank page", async () => {
    mockedGet.mockRejectedValue(new ApiError(404, "Not found"));
    renderPage("no-such-posting");

    expect(await screen.findByRole("heading", { name: "Posting not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all openings" })).toHaveAttribute("href", "/careers");
  });
});
