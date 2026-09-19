import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as auditLogsApi from "@/api/auditLogs";
import { ApiError } from "@/api/client";
import * as jobDistributionApi from "@/api/jobDistribution";
import * as jobPostingChannelsApi from "@/api/jobPostingChannels";
import * as jobPostingsApi from "@/api/jobPostings";
import * as locationsApi from "@/api/locations";
import * as recruitmentChannelsApi from "@/api/recruitmentChannels";
import type {
  JobPostingChannelRead,
  JobPostingRead,
  Permission,
  PostingAttemptRead,
  RankedApplicationRead,
  RecruitmentChannelRead,
  UserRead,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { JobPostingDetailPage } from "@/pages/JobPostingDetailPage";

vi.mock("@/api/auditLogs");
vi.mock("@/api/jobPostings");
vi.mock("@/api/jobDistribution");
vi.mock("@/api/jobPostingChannels");
vi.mock("@/api/locations");
vi.mock("@/api/recruitmentChannels");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJobPosting = vi.mocked(jobPostingsApi.getJobPosting);
const mockedRankCandidates = vi.mocked(jobPostingsApi.rankCandidates);
const mockedUpdateJobPosting = vi.mocked(jobPostingsApi.updateJobPosting);
const mockedPause = vi.mocked(jobPostingsApi.pauseJobPosting);
const mockedClose = vi.mocked(jobPostingsApi.closeJobPosting);
const mockedSubmit = vi.mocked(jobPostingsApi.submitJobPostingForReview);
const mockedReturn = vi.mocked(jobPostingsApi.returnJobPostingToDraft);
const mockedApprove = vi.mocked(jobPostingsApi.approveJobPosting);
const mockedPublish = vi.mocked(jobPostingsApi.publishJobPosting);
const mockedGenerate = vi.mocked(jobPostingsApi.generateJobPostingContent);
const mockedAiStatus = vi.mocked(jobPostingsApi.getContentGenerationStatus);
const mockedGetJobAd = vi.mocked(jobDistributionApi.getJobAd);
const mockedGetQrCodeBlob = vi.mocked(jobDistributionApi.getQrCodeBlob);
const mockedGetPosterBlob = vi.mocked(jobDistributionApi.getPosterBlob);
const mockedListPostingChannels = vi.mocked(jobPostingChannelsApi.listPostingChannels);
const mockedListHistory = vi.mocked(jobPostingChannelsApi.listPostingHistory);
const mockedRecommend = vi.mocked(jobPostingChannelsApi.recommendPostingChannels);
const mockedReview = vi.mocked(jobPostingChannelsApi.reviewPostingChannel);
const mockedAttach = vi.mocked(jobPostingChannelsApi.attachPostingChannel);
const mockedRecordManual = vi.mocked(jobPostingChannelsApi.recordManualPosting);
const mockedListRecruitmentChannels = vi.mocked(recruitmentChannelsApi.listRecruitmentChannels);
const mockedListAuditLogs = vi.mocked(auditLogsApi.listAuditLogs);
const mockedListLocations = vi.mocked(locationsApi.listLocations);

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
  available_count: 1,
  positions_requested: 3,
  positions_filled: 1,
  positions_remaining: 2,
  posting_number: "JP-2026-000001",
  status: "PUBLISHED",
  ad_title: "Assistant Professor (CSE)",
  ad_body: "Join the CSE department.",
  apply_deadline: null,
  contact_email: null,
  last_edited_by_id: null,
  last_edited_by_name: null,
  last_edited_at: null,
  is_accepting_applications: true,
  vacancy_request_id: "vr-1",
  vacancy_request_ref: "VR-2026-000007",
  requisition_number: "RQ-2026-000001",
  campus_code: "SSE",
  campus_name: "SIMATS Engineering",
  department_name: "Computer Science",
  designation_id: "des-1",
  designation_name: "Assistant Professor (Grade II)",
  priority: "HIGH",
  required_by: "2026-10-01",
  summary: "Teach and research in CSE.",
  responsibilities: "- Teach undergraduate courses",
  required_qualification: "PhD in Computer Science",
  required_experience: "3+ years",
  required_skills: ["Research"],
  preferred_skills: null,
  employment_type: "FULL_TIME",
  location_id: "loc-1",
  location_label: "Main Block, Block A",
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
  created_by_id: "u-hr",
  created_by_name: "Hema HR",
  submitted_for_review_by_id: null,
  submitted_for_review_by_name: null,
  submitted_for_review_at: null,
  approved_by_id: "u-hr",
  approved_by_name: "Hema HR",
  approved_at: "2026-01-04T00:00:00Z",
  published_by_id: "u-hr",
  published_by_name: "Hema HR",
  created_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
};

function posting(overrides: Partial<JobPostingRead>): JobPostingRead {
  return { ...JOB_POSTING, ...overrides };
}
const UNPUBLISHED = { is_active: false, published_at: null, published_by_id: null, published_by_name: null, is_accepting_applications: false };
const DRAFT = posting({ ...UNPUBLISHED, status: "DRAFT" });
const IN_REVIEW = posting({ ...UNPUBLISHED, status: "READY_FOR_REVIEW" });
const APPROVED = posting({ ...UNPUBLISHED, status: "APPROVED" });

const JOB_AD = {
  job_posting_id: "jp-1",
  position_title: "Assistant Professor (CSE)",
  campus_code: "SSE",
  employment_type: "FULL_TIME",
  role_category: "TEACHING",
  qualification: "PhD",
  experience_required: "3+ years",
  body: "Join the CSE department.",
  apply_url: "https://apply.example.com/careers/slug-1",
  public_apply_slug: "slug-1",
};

function channel(overrides: Partial<RecruitmentChannelRead>): RecruitmentChannelRead {
  return {
    id: "ch-x",
    code: "X",
    name: "X",
    kind: "JOB_PORTAL",
    mode: "MANUAL_ASSISTED",
    integration_path: null,
    config: null,
    applicable_categories: [],
    applicable_campus_ids: [],
    is_active: true,
    display_order: 100,
    notes: null,
    configuration_status: "MANUAL",
    configuration_message: null,
    posting_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
const CAREERS = channel({ id: "ch-careers", code: "CAREERS_PAGE", name: "SIMATS Careers", kind: "CAREERS_PAGE", mode: "INTERNAL", configuration_status: "AUTOMATIC", display_order: 10 });
const FACULTY = channel({ id: "ch-faculty", code: "FACULTYPLUS", name: "FacultyPlus", kind: "ACADEMIC_PORTAL", posting_url: "https://employer.facultyplus.example/post", display_order: 50 });
const PORTAL = channel({ id: "ch-portal", code: "PORTAL", name: "Job Portal", mode: "API", integration_path: "job-distribution", configuration_status: "NOT_CONFIGURED", configuration_message: "Integration not configured (N8N_BASE_URL is not set)", display_order: 60 });
const LINKEDIN = channel({ id: "ch-linkedin", code: "LINKEDIN", name: "LinkedIn", mode: "API", integration_path: "job-distribution", configuration_status: "READY", display_order: 20 });

function rowFor(source: RecruitmentChannelRead, overrides: Partial<JobPostingChannelRead> = {}): JobPostingChannelRead {
  return {
    id: `jpc-${source.code}`,
    job_posting_id: "jp-1",
    channel_id: source.id,
    channel_code: source.code,
    channel_name: source.name,
    channel_mode: source.mode,
    channel_configuration_status: source.configuration_status,
    channel_configuration_message: source.configuration_message,
    channel_posting_url: source.posting_url,
    campus_id: "c-sse",
    status: "SELECTED",
    recommended_by: "RULE",
    recommendation_reason: null,
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

function attempt(overrides: Partial<PostingAttemptRead> = {}): PostingAttemptRead {
  return {
    id: "a-1",
    job_posting_channel_id: "jpc-1",
    attempt_number: 1,
    trigger: "MANUAL",
    outcome: "SUCCEEDED",
    request_payload: null,
    response_payload: null,
    error_message: null,
    attempted_by_id: null,
    attempted_at: "2026-01-06T00:00:00Z",
    ...overrides,
  };
}

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

const EVERYTHING: Permission[] = [
  "EDIT_JOB_POSTING",
  "APPROVE_JOB_POSTING",
  "PUBLISH_JOB_POSTING",
  "CLOSE_VACANCY",
  "JOB_DISTRIBUTION",
  "REVIEW_POSTING_CHANNELS",
  "ACTIVITY_LOG",
];
const CHANNEL_WORK: Permission[] = ["JOB_DISTRIBUTION", "REVIEW_POSTING_CHANNELS"];

function authAs(role: UserRead["role"], permissions: Permission[] = []) {
  mockedUseAuth.mockReturnValue({
    user: { role } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission: (permission: string) => permissions.includes(permission as Permission),
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

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

describe("JobPostingDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetJobPosting.mockResolvedValue(JOB_POSTING);
    mockedRankCandidates.mockResolvedValue([]);
    mockedGetJobAd.mockResolvedValue(JOB_AD);
    mockedListPostingChannels.mockResolvedValue([]);
    mockedListHistory.mockResolvedValue([]);
    mockedListRecruitmentChannels.mockResolvedValue([CAREERS, FACULTY, PORTAL]);
    mockedAiStatus.mockResolvedValue({ configured: true, provider: "openai", model: "gpt-4o", message: null });
    mockedListAuditLogs.mockResolvedValue([]);
    mockedListLocations.mockResolvedValue([]);
  });

  // --- A, C, D, H --------------------------------------------------------------

  it("shows job information read from the vacancy request's master data", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    renderPage();
    expect(await screen.findByText("Job information")).toBeInTheDocument();
    expect(screen.getByText("VR-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("RQ-2026-000001")).toBeInTheDocument();
    expect(screen.getByText("SSE · SIMATS Engineering")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor (Grade II)")).toBeInTheDocument();
    expect(screen.getByText("Main Block, Block A")).toBeInTheDocument();
    expect(screen.getByText("Full Time")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View vacancy request" })).toHaveAttribute("href", "/vacancy-requests/vr-1");
  });

  it("shows positions requested, filled and remaining as read-only counts", async () => {
    authAs("HR_ADMIN");
    renderPage();
    expect(within(await screen.findByTestId("positions-requested")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByTestId("positions-filled")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByTestId("positions-remaining")).getByText("2")).toBeInTheDocument();
  });

  it("hides channels, history, activity and every control from a viewer without posting permissions", async () => {
    authAs("CAMPUS_HOD");
    renderPage();
    expect(await screen.findByText("Job information")).toBeInTheDocument();
    for (const title of ["Publish to", "Channel status", "Posting history", "Activity"]) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
    for (const name of ["Edit", "Pause", "Close", "Submit for review", "Generate with AI"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(mockedListPostingChannels).not.toHaveBeenCalled();
    expect(mockedListAuditLogs).not.toHaveBeenCalled();
    expect(mockedGetJobAd).not.toHaveBeenCalled();
  });

  it("shows the audit trail, and the activity log to an ACTIVITY_LOG holder", async () => {
    authAs("HR_ADMIN", ["ACTIVITY_LOG"]);
    mockedListAuditLogs.mockResolvedValue([
      {
        id: "log-1", actor_user_id: "u-hr", actor_role_snapshot: "HR_ADMIN", campus_context_id: "c-sse",
        action: "JOB_POSTING_CONTENT_GENERATED", entity_type: "JobPosting", entity_id: "jp-1",
        before_state: null, after_state: null, http_method: null, http_path: null, status_code: null,
        ip_address: null, user_agent: null, created_at: "2026-01-04T10:00:00Z",
      },
    ]);
    renderPage();
    expect(await screen.findByText("Audit information")).toBeInTheDocument();
    expect(screen.getAllByText(/by Hema HR/).length).toBeGreaterThanOrEqual(3);
    expect(await screen.findByText("Content generated")).toBeInTheDocument();
    expect(mockedListAuditLogs).toHaveBeenCalledWith({ entityType: "JobPosting", entityId: "jp-1", limit: 20 });
  });

  it("shows the public page link and QR code once published", async () => {
    authAs("RECRUITMENT_OFFICER", ["JOB_DISTRIBUTION"]);
    mockedGetQrCodeBlob.mockResolvedValue(new Blob(["fake-png-bytes"], { type: "image/png" }));
    renderPage();
    const link = await screen.findByRole("link", { name: JOB_AD.apply_url });
    expect(link).toHaveAttribute("target", "_blank");
    await userEvent.click(screen.getByRole("button", { name: "Generate QR code" }));
    expect(await screen.findByAltText("Apply QR code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PNG" })).toHaveAttribute("download", "job-posting-jp-1-qr.png");
  });

  it("downloads the printable poster for a published posting", async () => {
    authAs("RECRUITMENT_OFFICER", ["JOB_DISTRIBUTION"]);
    mockedGetPosterBlob.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:poster");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Download poster (PDF)" }));
      await waitFor(() => expect(mockedGetPosterBlob).toHaveBeenCalledWith("jp-1"));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(await screen.findByText("Poster downloaded.")).toBeInTheDocument();
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("offers no poster before the posting is published", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedGetJobPosting.mockResolvedValue(APPROVED);
    renderPage();
    expect(await screen.findByText("Application details")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download poster (PDF)" })).not.toBeInTheDocument();
  });

  it("renders ranked candidates in the returned order with a link to the application", async () => {
    authAs("HR_ADMIN");
    mockedRankCandidates.mockResolvedValue([
      makeRanked({ application_id: "app-1", candidate_full_name: "Jane Doe" }),
      makeRanked({ application_id: "app-2", candidate_full_name: "Bob Ray", is_duplicate: true }),
    ]);
    renderPage();
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveAttribute("href", "/applications/app-1");
  });

  // --- Workflow ----------------------------------------------------------------

  it("submits a draft for review, which is not yet public", async () => {
    authAs("RECRUITMENT_OFFICER", ["EDIT_JOB_POSTING", "PUBLISH_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    mockedSubmit.mockResolvedValue(IN_REVIEW);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith("jp-1"));
    expect(screen.getByText("Available once published")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("lets an approver approve a posting in review, or return it to draft with a reason", async () => {
    authAs("HR_ADMIN", ["APPROVE_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(IN_REVIEW);
    mockedApprove.mockResolvedValue(APPROVED);
    mockedReturn.mockResolvedValue(DRAFT);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith("jp-1"));

    await userEvent.click(screen.getByRole("button", { name: "Return to draft" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Wrong salary");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to draft" }));
    await waitFor(() => expect(mockedReturn).toHaveBeenCalledWith("jp-1", "Wrong salary"));
  });

  it("does not offer Approve to someone who can only edit", async () => {
    authAs("RECRUITMENT_OFFICER", ["EDIT_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(IN_REVIEW);
    renderPage();
    expect(await screen.findByRole("button", { name: "Return to draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("publishes an approved posting", async () => {
    authAs("RECRUITMENT_OFFICER", ["PUBLISH_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(APPROVED);
    mockedPublish.mockResolvedValue(JOB_POSTING);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledWith("jp-1"));
  });

  it("pauses a published posting and closes only after confirmation", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedPause.mockResolvedValue(posting({ status: "PAUSED" }));
    mockedClose.mockResolvedValue(posting({ status: "CLOSED", is_active: false }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mockedPause).toHaveBeenCalledWith("jp-1"));

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Close this posting?")).toBeInTheDocument();
    expect(mockedClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close posting and vacancy" }));
    await waitFor(() => expect(mockedClose).toHaveBeenCalledWith("jp-1"));
  });

  it("hides every write control on a closed posting", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedGetJobPosting.mockResolvedValue(posting({ status: "CLOSED", is_active: false, closed_at: "2026-02-01T00:00:00Z" }));
    mockedListPostingChannels.mockResolvedValue([rowFor(FACULTY, { status: "REMOVED" })]);
    renderPage();
    expect((await screen.findAllByText("Closed")).length).toBeGreaterThan(0);
    for (const name of ["Edit", "Pause", "Close", "Run channel rules", "Remove", "Select", "Mark as published"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("shows the backend's message when a lifecycle action is refused", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedPause.mockRejectedValue(new ApiError(409, "This job posting is already paused"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("This job posting is already paused")).toBeInTheDocument();
  });

  // --- B: content and AI ---------------------------------------------------------

  it("edits the structured job content", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    mockedUpdateJobPosting.mockResolvedValue(DRAFT);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const description = screen.getByLabelText("Job description");
    await userEvent.clear(description);
    await userEvent.type(description, "New text");
    const skills = screen.getByLabelText("Required skills");
    await userEvent.clear(skills);
    await userEvent.type(skills, "Python, Teaching");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedUpdateJobPosting).toHaveBeenCalledWith(
        "jp-1",
        expect.objectContaining({
          ad_title: "Assistant Professor (CSE)",
          ad_body: "New text",
          required_skills: ["Python", "Teaching"],
          summary: "Teach and research in CSE.",
          location_id: "loc-1",
          employment_type: "FULL_TIME",
        }),
      ),
    );
  });

  it("warns that saving a posting under review sends it back to draft", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedGetJobPosting.mockResolvedValue(IN_REVIEW);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Saving a change sends it back to draft/)).toBeInTheDocument();
  });

  it("refuses an inverted salary range before calling the server", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Salary from (₹, optional)"), "50000");
    await userEvent.type(screen.getByLabelText("Salary to (₹, optional)"), "10000");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Salary from cannot be more than salary to.")).toBeInTheDocument();
    expect(mockedUpdateJobPosting).not.toHaveBeenCalled();
  });

  it("generates an AI draft for a draft posting", async () => {
    authAs("RECRUITMENT_OFFICER", ["EDIT_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    mockedGenerate.mockResolvedValue(DRAFT);
    renderPage();
    expect(await screen.findByText(/AI writes a draft only/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    await userEvent.type(await screen.findByLabelText("Instructions (optional)"), "Mention the labs");
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledWith("jp-1", "Mention the labs"));
  });

  it("explains when AI drafting is not configured instead of failing", async () => {
    authAs("RECRUITMENT_OFFICER", ["EDIT_JOB_POSTING"]);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    mockedAiStatus.mockResolvedValue({
      configured: false,
      provider: "openai",
      model: null,
      message: "AI features are not configured (OPENAI_API_KEY is not set)",
    });
    renderPage();
    expect(await screen.findByText(/AI drafting is not configured on this server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate with AI" })).toBeDisabled();
    // The rest of the posting still works.
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });

  it("does not offer AI drafting once a posting is published", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    renderPage();
    expect(await screen.findByText("Job description")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate with AI" })).not.toBeInTheDocument();
    // The status endpoint itself IS still called: the poster card offers AI
    // wording in every status but CLOSED, and asks the same endpoint. What
    // must not come back after publication is the job-description draft,
    // which the assertion above pins.
  });

  // --- E, F, G: channels --------------------------------------------------------------

  it("lists every applicable channel with how it is posted, and selects one while still a draft", async () => {
    authAs("RECRUITMENT_OFFICER", CHANNEL_WORK);
    mockedGetJobPosting.mockResolvedValue(DRAFT);
    mockedListPostingChannels.mockResolvedValue([rowFor(CAREERS)]);
    mockedAttach.mockResolvedValue(rowFor(FACULTY));
    renderPage();

    const careers = await screen.findByTestId("publish-to-CAREERS_PAGE");
    expect(within(careers).getByText("Automatic")).toBeInTheDocument();
    expect(within(careers).getByText("Selected")).toBeInTheDocument();
    const faculty = screen.getByTestId("publish-to-FACULTYPLUS");
    expect(within(faculty).getByText("Manual posting")).toBeInTheDocument();
    expect(within(faculty).getByText("Not selected")).toBeInTheDocument();
    expect(within(screen.getByTestId("publish-to-PORTAL")).getByText("Integration not configured")).toBeInTheDocument();
    expect(screen.getByText(/posted once this job posting is published/)).toBeInTheDocument();

    // Nothing is posted before the posting is live.
    const careersStatus = screen.getByTestId("channel-CAREERS_PAGE");
    expect(within(careersStatus).queryByRole("button", { name: "Publish now" })).not.toBeInTheDocument();
    expect(within(careersStatus).getByText("Waiting for the job posting to be published.")).toBeInTheDocument();

    await userEvent.click(within(faculty).getByRole("button", { name: "Select" }));
    await waitFor(() => expect(mockedAttach).toHaveBeenCalledWith("jp-1", "ch-faculty"));
  });

  it("selects a rule's recommendation through the review endpoint", async () => {
    authAs("RECRUITMENT_OFFICER", CHANNEL_WORK);
    mockedListPostingChannels.mockResolvedValue([
      rowFor(FACULTY, { status: "RECOMMENDED", recommendation_reason: "Teaching posts: academic portals" }),
    ]);
    mockedReview.mockResolvedValue(rowFor(FACULTY));
    renderPage();
    const faculty = await screen.findByTestId("publish-to-FACULTYPLUS");
    expect(within(faculty).getByText(/Teaching posts: academic portals/)).toBeInTheDocument();
    await userEvent.click(within(faculty).getByRole("button", { name: "Select" }));
    await waitFor(() => expect(mockedReview).toHaveBeenCalledWith("jp-1", "ch-faculty", "SELECT"));
  });

  it("guides a manual channel: copy the content, open the portal, and mark it published with a date", async () => {
    authAs("RECRUITMENT_OFFICER", CHANNEL_WORK);
    const writeText = mockClipboard();
    mockedListPostingChannels.mockResolvedValue([rowFor(FACULTY, { status: "QUEUED", attempt_count: 1 })]);
    mockedRecordManual.mockResolvedValue(rowFor(FACULTY, { status: "POSTED" }));
    renderPage();

    const faculty = await screen.findByTestId("channel-FACULTYPLUS");
    expect(within(faculty).getByText("Manual action required")).toBeInTheDocument();
    await userEvent.click(within(faculty).getByRole("button", { name: "Copy job description" }));
    expect(writeText).toHaveBeenCalledWith("Join the CSE department.");
    await waitFor(() => expect(mockedGetJobAd).toHaveBeenCalled());
    await userEvent.click(within(faculty).getByRole("button", { name: "Copy posting content" }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(`Apply: ${JOB_AD.apply_url}`));
    expect(within(faculty).getByRole("link", { name: "Open FacultyPlus" })).toHaveAttribute(
      "href",
      "https://employer.facultyplus.example/post",
    );

    await userEvent.click(within(faculty).getByRole("button", { name: "Mark as published" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("URL"), "https://facultyplus.example/ad/9");
    fireEvent.change(within(dialog).getByLabelText("Published on (leave empty for today)"), { target: { value: "2026-09-10" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as published" }));
    await waitFor(() =>
      expect(mockedRecordManual).toHaveBeenCalledWith("jp-1", "ch-faculty", {
        external_ref: null,
        external_url: "https://facultyplus.example/ad/9",
        posted_on: "2026-09-10",
      }),
    );
  });

  it("never offers Post for a channel whose integration is not configured", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedListPostingChannels.mockResolvedValue([rowFor(PORTAL)]);
    renderPage();
    const portal = await screen.findByTestId("channel-PORTAL");
    expect(within(portal).getByText(/Integration not configured. Post it by hand/)).toBeInTheDocument();
    expect(within(portal).queryByRole("button", { name: "Post" })).not.toBeInTheDocument();
    expect(within(portal).getByRole("button", { name: "Mark as published" })).toBeInTheDocument();
  });

  it("surfaces a failed attempt as a retry, and runs the rules on demand", async () => {
    authAs("HR_ADMIN", EVERYTHING);
    mockedListRecruitmentChannels.mockResolvedValue([LINKEDIN]);
    mockedListPostingChannels.mockResolvedValue([
      rowFor(LINKEDIN, { status: "FAILED", attempt_count: 1, last_error: "Timed out reaching n8n" }),
    ]);
    mockedRecommend.mockResolvedValue({ created: [] });
    renderPage();
    const linkedin = await screen.findByTestId("channel-LINKEDIN");
    expect(within(linkedin).getByText("Failed")).toBeInTheDocument();
    expect(within(linkedin).getByText("Timed out reaching n8n")).toBeInTheDocument();
    expect(within(linkedin).getByRole("button", { name: "Retry" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Run channel rules" }));
    await waitFor(() => expect(mockedRecommend).toHaveBeenCalledWith("jp-1"));
    expect(await screen.findByText("No new channels to recommend.")).toBeInTheDocument();
  });

  it("lists the posting history across channels", async () => {
    authAs("HR_ADMIN", ["JOB_DISTRIBUTION"]);
    mockedListHistory.mockResolvedValue([
      { ...attempt({ id: "a-2", outcome: "FAILED", error_message: "Portal down" }), channel_id: "ch-linkedin", channel_code: "LINKEDIN", channel_name: "LinkedIn" },
      { ...attempt({ id: "a-1" }), channel_id: "ch-careers", channel_code: "CAREERS_PAGE", channel_name: "SIMATS Careers" },
    ]);
    renderPage();
    expect(await screen.findByText("Posting history")).toBeInTheDocument();
    expect(await screen.findByText("Portal down")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
