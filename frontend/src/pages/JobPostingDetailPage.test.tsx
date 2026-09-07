import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as jobDistributionApi from "@/api/jobDistribution";
import * as jobPostingChannelsApi from "@/api/jobPostingChannels";
import * as jobPostingsApi from "@/api/jobPostings";
import * as recruitmentChannelsApi from "@/api/recruitmentChannels";
import type {
  JobPostingChannelRead,
  JobPostingRead,
  RankedApplicationRead,
  RecruitmentChannelRead,
  UserRead,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { JobPostingDetailPage } from "@/pages/JobPostingDetailPage";

vi.mock("@/api/jobPostings");
vi.mock("@/api/jobDistribution");
vi.mock("@/api/jobPostingChannels");
vi.mock("@/api/recruitmentChannels");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedGetJobPosting = vi.mocked(jobPostingsApi.getJobPosting);
const mockedRankCandidates = vi.mocked(jobPostingsApi.rankCandidates);
const mockedUpdateJobPosting = vi.mocked(jobPostingsApi.updateJobPosting);
const mockedPauseJobPosting = vi.mocked(jobPostingsApi.pauseJobPosting);
const mockedCloseJobPosting = vi.mocked(jobPostingsApi.closeJobPosting);
const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJobAd = vi.mocked(jobDistributionApi.getJobAd);
const mockedGetQrCodeBlob = vi.mocked(jobDistributionApi.getQrCodeBlob);
const mockedListPostingChannels = vi.mocked(jobPostingChannelsApi.listPostingChannels);
const mockedRecommend = vi.mocked(jobPostingChannelsApi.recommendPostingChannels);
const mockedReview = vi.mocked(jobPostingChannelsApi.reviewPostingChannel);
const mockedPost = vi.mocked(jobPostingChannelsApi.postPostingChannel);
const mockedAttach = vi.mocked(jobPostingChannelsApi.attachPostingChannel);
const mockedListRecruitmentChannels = vi.mocked(recruitmentChannelsApi.listRecruitmentChannels);

const JOB_POSTING: JobPostingRead = {
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  role_category: "TEACHING",
  public_apply_slug: "slug-1",
  published_at: "2026-01-05T00:00:00Z",
  closed_at: null,
  is_active: true,
  position_title: "Assistant Professor",
  department_id: "d-cse",
  requested_count: 2,
  available_count: 0,
  posting_number: "JP-2026-000001",
  status: "PUBLISHED",
  ad_title: "Assistant Professor (CSE)",
  ad_body: "Join the CSE department.",
  apply_deadline: null,
  contact_email: null,
  last_edited_by_id: null,
  last_edited_at: null,
  is_accepting_applications: true,
  vacancy_request_id: "vr-1",
  requisition_number: "RQ-2026-000001",
  created_at: "2026-01-05T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
};

const JOB_AD = {
  job_posting_id: "jp-1",
  position_title: "Assistant Professor (CSE)",
  campus_code: "SSE",
  employment_type: "FULL_TIME",
  role_category: "TEACHING",
  qualification: "PhD",
  experience_required: "3+ years",
  body: "Join the CSE department.",
  apply_url: "https://apply.example.com/slug-1",
  public_apply_slug: "slug-1",
};

function channelRow(overrides: Partial<JobPostingChannelRead> = {}): JobPostingChannelRead {
  return {
    id: "jpc-1",
    job_posting_id: "jp-1",
    channel_id: "ch-linkedin",
    channel_code: "LINKEDIN",
    channel_name: "LinkedIn",
    channel_mode: "API",
    campus_id: "c-sse",
    status: "RECOMMENDED",
    recommended_by: "RULE",
    recommendation_reason: "Teaching posts: academic and professional portals",
    reviewed_by_id: null,
    reviewed_at: null,
    external_ref: null,
    external_url: null,
    posted_at: null,
    expires_at: null,
    removed_at: null,
    attempt_count: 0,
    last_error: null,
    last_attempt_id: null,
    created_at: "2026-01-05T00:00:00Z",
    updated_at: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

const NAUKRI: RecruitmentChannelRead = {
  id: "ch-naukri",
  code: "NAUKRI",
  name: "Naukri",
  kind: "JOB_PORTAL",
  mode: "API",
  integration_path: "job-distribution",
  config: null,
  applicable_categories: [],
  applicable_campus_ids: [],
  is_active: true,
  display_order: 40,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeRanked(overrides: Partial<RankedApplicationRead> = {}): RankedApplicationRead {
  return {
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_full_name: "Jane Doe",
    candidate_email: "jane@example.com",
    application_status: "SCREENING",
    overall_recruitment_score: 81,
    eligibility_score: 82.5,
    is_duplicate: false,
    is_incomplete_profile: false,
    ...overrides,
  };
}

function authAs(role: UserRead["role"], permissions: string[] = []) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission: (permission: string) => permissions.includes(permission),
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/job-postings/jp-1"]}>
          <Routes>
            <Route path="/job-postings/:id" element={<JobPostingDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("JobPostingDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetJobPosting.mockResolvedValue(JOB_POSTING);
    mockedRankCandidates.mockResolvedValue([]);
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    mockedListPostingChannels.mockResolvedValue([]);
    mockedListRecruitmentChannels.mockResolvedValue([NAUKRI]);
  });

  it("shows the posting number, requisition number, status and a link to the vacancy request", async () => {
    authAs("HR_ADMIN");
    renderPage();
    expect(await screen.findByText("JP-2026-000001")).toBeInTheDocument();
    expect(screen.getByText("RQ-2026-000001")).toBeInTheDocument();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View vacancy request" })).toHaveAttribute("href", "/vacancy-requests/vr-1");
  });

  it("renders ranked candidates in the returned order with a link to the application", async () => {
    authAs("HR_ADMIN");
    mockedRankCandidates.mockResolvedValue([
      makeRanked({ application_id: "app-1", candidate_full_name: "Jane Doe", overall_recruitment_score: 81 }),
      makeRanked({ application_id: "app-2", candidate_full_name: "Bob Ray", overall_recruitment_score: 60, is_duplicate: true }),
    ]);
    renderPage();
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Jane Doe")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bob Ray")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveAttribute("href", "/applications/app-1");
  });

  it("hides the advertisement and channels for a role without JOB_DISTRIBUTION", async () => {
    authAs("CAMPUS_HOD");
    renderPage();
    await waitFor(() => expect(screen.getByText("Posting")).toBeInTheDocument());
    expect(screen.queryByText("Advertisement")).not.toBeInTheDocument();
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
    expect(mockedGetJobAd).not.toHaveBeenCalled();
    expect(mockedListPostingChannels).not.toHaveBeenCalled();
    // No lifecycle buttons either: a HoD holds neither EDIT_JOB_POSTING nor CLOSE_VACANCY.
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("shows the advertisement and channels to a CAMPUS_HOD individually granted JOB_DISTRIBUTION", async () => {
    authAs("CAMPUS_HOD", ["JOB_DISTRIBUTION"]);
    renderPage();
    expect(await screen.findByText("Advertisement")).toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
  });

  it("shows the job ad text and lets HR Admin copy it", async () => {
    authAs("HR_ADMIN");
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderPage();
    await waitFor(() => expect(screen.getByText(JOB_AD.body)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JOB_AD.body);
  });

  it("shows the posting's public page link next to the advertisement", async () => {
    authAs("HR_ADMIN");
    renderPage();
    await waitFor(() => expect(screen.getByText(JOB_AD.body)).toBeInTheDocument());
    const link = screen.getByRole("link", { name: JOB_AD.apply_url });
    expect(link).toHaveAttribute("href", JOB_AD.apply_url);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("generates the QR code and offers a download link", async () => {
    authAs("RECRUITMENT_OFFICER");
    mockedGetQrCodeBlob.mockResolvedValue(new Blob(["fake-png-bytes"], { type: "image/png" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Generate QR code" }));
    expect(await screen.findByAltText("Apply QR code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PNG" })).toHaveAttribute("download", "job-posting-jp-1-qr.png");
  });

  it("edits the advertisement through the dialog", async () => {
    authAs("HR_ADMIN");
    mockedUpdateJobPosting.mockResolvedValue({ ...JOB_POSTING, ad_body: "New text" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const body = screen.getByLabelText("Advertisement text");
    await userEvent.clear(body);
    await userEvent.type(body, "New text");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedUpdateJobPosting).toHaveBeenCalledWith("jp-1", {
        ad_title: "Assistant Professor (CSE)",
        ad_body: "New text",
        apply_deadline: null,
        contact_email: null,
      }),
    );
  });

  it("pauses a published posting and closes only after confirmation", async () => {
    authAs("HR_ADMIN");
    mockedPauseJobPosting.mockResolvedValue({ ...JOB_POSTING, status: "PAUSED" });
    mockedCloseJobPosting.mockResolvedValue({ ...JOB_POSTING, status: "CLOSED", is_active: false });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mockedPauseJobPosting).toHaveBeenCalledWith("jp-1"));

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Close this posting?")).toBeInTheDocument();
    expect(mockedCloseJobPosting).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close posting and vacancy" }));
    await waitFor(() => expect(mockedCloseJobPosting).toHaveBeenCalledWith("jp-1"));
  });

  it("hides every write control on a closed posting", async () => {
    authAs("HR_ADMIN");
    mockedGetJobPosting.mockResolvedValue({ ...JOB_POSTING, status: "CLOSED", is_active: false, closed_at: "2026-02-01T00:00:00Z" });
    mockedListPostingChannels.mockResolvedValue([channelRow({ status: "REMOVED" })]);
    renderPage();
    expect((await screen.findAllByText("Closed")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run channel rules" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("lists channels with their rule, lets the recruiter select a recommendation, then post it", async () => {
    authAs("RECRUITMENT_OFFICER");
    // First load: recommended. Every refetch after the review: selected.
    mockedListPostingChannels
      .mockResolvedValueOnce([
        channelRow(),
        channelRow({ id: "jpc-2", channel_id: "ch-careers", channel_code: "CAREERS_PAGE", channel_name: "Careers page", channel_mode: "INTERNAL", status: "POSTED", recommendation_reason: "Careers page for every posting", attempt_count: 1 }),
      ])
      .mockResolvedValue([channelRow({ status: "SELECTED" })]);
    mockedReview.mockResolvedValue(channelRow({ status: "SELECTED" }));
    mockedPost.mockResolvedValue({
      channel: channelRow({ status: "POSTED", attempt_count: 1 }),
      attempt: { id: "a-1", job_posting_channel_id: "jpc-1", attempt_number: 1, trigger: "MANUAL", outcome: "SUCCEEDED", request_payload: null, response_payload: null, error_message: null, attempted_by_id: null, attempted_at: "2026-01-06T00:00:00Z" },
    });
    renderPage();

    const linkedin = await screen.findByTestId("channel-LINKEDIN");
    expect(within(linkedin).getByText("Recommended")).toBeInTheDocument();
    expect(within(linkedin).getByText(/Teaching posts: academic and professional portals/)).toBeInTheDocument();
    // A recommendation cannot be posted before it is selected.
    expect(within(linkedin).queryByRole("button", { name: "Post" })).not.toBeInTheDocument();
    const careers = screen.getByTestId("channel-CAREERS_PAGE");
    expect(within(careers).getByText("Posted")).toBeInTheDocument();

    await userEvent.click(within(linkedin).getByRole("button", { name: "Select" }));
    await waitFor(() => expect(mockedReview).toHaveBeenCalledWith("jp-1", "ch-linkedin", "SELECT"));

    await userEvent.click(await screen.findByRole("button", { name: "Post" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("jp-1", "ch-linkedin"));
  });

  it("surfaces a failed attempt as a retry with the error, and runs the rules on demand", async () => {
    authAs("HR_ADMIN");
    mockedListPostingChannels.mockResolvedValue([
      channelRow({ status: "FAILED", attempt_count: 1, last_error: "Job-portal distribution is not configured (N8N_BASE_URL is not set)" }),
    ]);
    mockedRecommend.mockResolvedValue({ created: [] });
    renderPage();
    const linkedin = await screen.findByTestId("channel-LINKEDIN");
    expect(within(linkedin).getByText("Failed")).toBeInTheDocument();
    expect(within(linkedin).getByText(/N8N_BASE_URL is not set/)).toBeInTheDocument();
    expect(within(linkedin).getByRole("button", { name: "Retry" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Run channel rules" }));
    await waitFor(() => expect(mockedRecommend).toHaveBeenCalledWith("jp-1"));
    expect(await screen.findByText("No new channels to recommend.")).toBeInTheDocument();
  });

  it("adds a channel that is not on the posting yet", async () => {
    authAs("HR_ADMIN");
    mockedAttach.mockResolvedValue(channelRow({ channel_id: "ch-naukri", channel_code: "NAUKRI", status: "SELECTED", recommended_by: "USER" }));
    renderPage();
    await userEvent.click(await screen.findByRole("combobox", { name: "Add a channel" }));
    await userEvent.click(await screen.findByRole("option", { name: "Naukri" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mockedAttach).toHaveBeenCalledWith("jp-1", "ch-naukri"));
  });

  it("shows the backend's message when a lifecycle action is refused", async () => {
    authAs("HR_ADMIN");
    mockedPauseJobPosting.mockRejectedValue(new ApiError(409, "This job posting is already paused"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("This job posting is already paused")).toBeInTheDocument();
  });
});
