import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as jobDistributionApi from "@/api/jobDistribution";
import * as jobPostingsApi from "@/api/jobPostings";
import type { JobPostingRead } from "@/api/types";
import { PosterCard } from "@/components/job-postings/PosterCard";
import { ToastProvider } from "@/components/ui/toast";
import { JOB_POSTING_DETAIL_DEFAULTS } from "@/test/jobPostingFixture";

vi.mock("@/api/jobPostings");
vi.mock("@/api/jobDistribution");

const mockedGenerateCopy = vi.mocked(jobPostingsApi.generatePosterCopy);
const mockedUpdateCopy = vi.mocked(jobPostingsApi.updatePosterCopy);
const mockedGenerateBackground = vi.mocked(jobPostingsApi.generatePosterBackground);
const mockedSetEnabled = vi.mocked(jobPostingsApi.setPosterBackgroundEnabled);
const mockedBackgroundBlob = vi.mocked(jobPostingsApi.getPosterBackgroundBlob);
const mockedCopyStatus = vi.mocked(jobPostingsApi.getContentGenerationStatus);
const mockedImageStatus = vi.mocked(jobPostingsApi.getPosterBackgroundStatus);
const mockedPosterBlob = vi.mocked(jobDistributionApi.getPosterBlob);
const mockedGenerateRolePhoto = vi.mocked(jobPostingsApi.generateRolePhoto);
const mockedSetRolePhoto = vi.mocked(jobPostingsApi.setRolePhotoEnabled);
const mockedRolePhotoBlob = vi.mocked(jobPostingsApi.getRolePhotoBlob);

const POSTING: JobPostingRead = {
  ...JOB_POSTING_DETAIL_DEFAULTS,
  id: "jp-1",
  approved_vacancy_id: "av-1",
  campus_id: "c-sse",
  role_category: "TEACHING",
  public_apply_slug: "assistant-professor",
  published_at: "2026-01-05T00:00:00Z",
  closed_at: null,
  is_active: true,
  position_title: "Assistant Professor",
  department_id: "d-cse",
  requested_count: 1,
  available_count: 0,
  posting_number: "JP-2026-000001",
  status: "PUBLISHED",
  ad_title: "Assistant Professor",
  ad_body: "Teach and research.",
  apply_deadline: null,
  contact_email: null,
  last_edited_by_id: null,
  last_edited_at: null,
  is_accepting_applications: true,
  vacancy_request_id: "vr-1",
  requisition_number: "RQ-2026-000001",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-05T00:00:00Z",
};

function renderCard(posting: Partial<JobPostingRead> = {}, props: { canEdit?: boolean; canDownload?: boolean } = {}) {
  const onChanged = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PosterCard
          jobPosting={{ ...POSTING, ...posting }}
          canEdit={props.canEdit ?? true}
          canDownload={props.canDownload ?? false}
          onChanged={onChanged}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onChanged };
}

const CONFIGURED = { configured: true, provider: "openai", model: "gpt-4o", message: null };

describe("PosterCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCopyStatus.mockResolvedValue(CONFIGURED);
    mockedImageStatus.mockResolvedValue({ ...CONFIGURED, model: "gpt-image-1" });
    mockedGenerateCopy.mockResolvedValue(POSTING);
    mockedUpdateCopy.mockResolvedValue(POSTING);
    mockedGenerateBackground.mockResolvedValue(POSTING);
    mockedSetEnabled.mockResolvedValue(POSTING);
    mockedBackgroundBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    mockedPosterBlob.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    mockedGenerateRolePhoto.mockResolvedValue(POSTING);
    mockedSetRolePhoto.mockResolvedValue(POSTING);
    mockedRolePhotoBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  });

  it("says what the poster prints when nothing has been written or drawn", () => {
    renderCard();
    expect(screen.getByText(/prints “WE ARE HIRING” above the job title/)).toBeInTheDocument();
    expect(screen.getByText(/prints its plain navy header/)).toBeInTheDocument();
  });

  it("drafts the wording and shows what came back", async () => {
    const user = userEvent.setup();
    const { onChanged } = renderCard();

    await user.click(screen.getByRole("button", { name: "Draft with AI" }));

    await waitFor(() => expect(mockedGenerateCopy).toHaveBeenCalledWith("jp-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("refuses to offer AI wording before the advertisement has any text", async () => {
    renderCard({ ad_body: null, summary: null });
    expect(await screen.findByText(/Write the job description first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  });

  it("sends edited wording, dropping the blanks", async () => {
    const user = userEvent.setup();
    renderCard({ poster_headline: "Join us", poster_bullets: ["Kept"] });

    await user.click(screen.getByRole("button", { name: "Edit wording" }));
    await user.type(screen.getByLabelText("Headline"), " today");
    await user.type(screen.getByLabelText("Pitch"), "A good place to teach.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedUpdateCopy).toHaveBeenCalledWith("jp-1", {
        poster_headline: "Join us today",
        poster_pitch: "A good place to teach.",
        // The two empty highlight rows the form starts with are not sent.
        poster_bullets: ["Kept"],
      }),
    );
  });

  it("never offers a sixth highlight, because the backend rejects one", async () => {
    const user = userEvent.setup();
    renderCard({ poster_bullets: ["a", "b", "c", "d"] });

    await user.click(screen.getByRole("button", { name: "Edit wording" }));
    expect(screen.getByLabelText("Highlight 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a highlight" }));

    expect(screen.getByLabelText("Highlight 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a highlight" })).not.toBeInTheDocument();
    expect(screen.getByText(/Five is the most the poster can lay out/)).toBeInTheDocument();
  });

  it("shows a drawn image as not printed until somebody switches it on", async () => {
    const user = userEvent.setup();
    renderCard({ has_poster_background: true, poster_background_enabled: false });

    expect(await screen.findByText("Not printed yet")).toBeInTheDocument();
    expect(screen.getByText(/printed under the SIMATS seal/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use it on the poster" }));
    await waitFor(() => expect(mockedSetEnabled).toHaveBeenCalledWith("jp-1", true));
  });

  it("says how long drawing takes, before and during the wait", async () => {
    // Measured against the real model on production 2026-09-17: 51 seconds.
    // A button that only says "Drawing…" for that long reads as hung.
    const user = userEvent.setup();
    mockedGenerateBackground.mockReturnValue(new Promise(() => {}));
    renderCard();

    // Said twice: once for the background, once for the role photo.
    expect(screen.getAllByText(/Drawing one takes about a minute/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Draw with AI" }));
    expect(await screen.findByRole("button", { name: /about a minute/ })).toBeDisabled();
  });

  it("offers to take an approved image back off the poster", async () => {
    const user = userEvent.setup();
    renderCard({ has_poster_background: true, poster_background_enabled: true });

    expect(await screen.findByText("Printed on the poster")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Do not print it" }));
    await waitFor(() => expect(mockedSetEnabled).toHaveBeenCalledWith("jp-1", false));
  });

  it("explains an unconfigured image model instead of failing on the click", async () => {
    mockedImageStatus.mockResolvedValue({
      configured: false,
      provider: "openai",
      model: null,
      message: "AI image generation is not configured (OPENAI_API_KEY is not set)",
    });
    renderCard();

    expect(await screen.findAllByText(/AI image generation is not configured/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Draw with AI" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Draw role photo" })).toBeDisabled();
  });

  it("surfaces the server's own refusal", async () => {
    const user = userEvent.setup();
    mockedGenerateCopy.mockRejectedValue(new ApiError(400, "Add a job description before generating poster copy"));
    renderCard();

    await user.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(await screen.findByText("Add a job description before generating poster copy")).toBeInTheDocument();
  });

  it("draws a role photo for campaign posters, separately from the background", async () => {
    const user = userEvent.setup();
    const { onChanged } = renderCard();

    expect(screen.getByText(/On a campaign poster this role prints without a picture/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Draw role photo" }));

    await waitFor(() => expect(mockedGenerateRolePhoto).toHaveBeenCalledWith("jp-1"));
    expect(mockedGenerateBackground).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("keeps a drawn role photo off campaign posters until somebody switches it on", async () => {
    const user = userEvent.setup();
    renderCard({ has_role_photo: true, role_photo_enabled: false });

    expect(await screen.findByText("Not printed yet")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Generated role photo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use it on campaign posters" }));

    await waitFor(() => expect(mockedSetRolePhoto).toHaveBeenCalledWith("jp-1", true));
    expect(mockedSetEnabled).not.toHaveBeenCalled();
  });

  it("only offers the download to someone who may print it", () => {
    renderCard({}, { canDownload: false });
    expect(screen.queryByRole("button", { name: "Download poster (PDF)" })).not.toBeInTheDocument();
  });

  it("shows no buttons at all to a reader who cannot edit", () => {
    renderCard({ has_poster_background: true }, { canEdit: false, canDownload: false });
    expect(screen.queryByRole("button", { name: "Draft with AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draw with AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use it on the poster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draw role photo" })).not.toBeInTheDocument();
    expect(mockedCopyStatus).not.toHaveBeenCalled();
  });

  it("offers nothing on a closed posting", () => {
    renderCard({ status: "CLOSED" });
    expect(screen.queryByRole("button", { name: "Draft with AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit wording" })).not.toBeInTheDocument();
  });
});
