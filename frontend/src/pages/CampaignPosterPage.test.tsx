import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campaignPostersApi from "@/api/campaignPosters";
import { ApiError } from "@/api/client";
import * as jobPostingsApi from "@/api/jobPostings";
import type { JobPostingRead, Permission, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { CampaignPosterPage } from "@/pages/CampaignPosterPage";
import { JOB_POSTING_DETAIL_DEFAULTS } from "@/test/jobPostingFixture";

vi.mock("@/api/jobPostings");
vi.mock("@/api/campaignPosters");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedList = vi.mocked(jobPostingsApi.listJobPostings);
const mockedPoster = vi.mocked(campaignPostersApi.getCampaignPosterBlob);

function posting(id: string, title: string, overrides: Partial<JobPostingRead> = {}): JobPostingRead {
  return {
    ...JOB_POSTING_DETAIL_DEFAULTS,
    id,
    approved_vacancy_id: `av-${id}`,
    campus_id: "c-sse",
    campus_code: "SSE",
    campus_name: "Saveetha School of Engineering",
    department_name: "Maintenance",
    role_category: "NON_TEACHING",
    public_apply_slug: id,
    published_at: "2026-09-01T00:00:00Z",
    closed_at: null,
    is_active: true,
    position_title: title,
    department_id: "d-maint",
    requested_count: 1,
    available_count: 0,
    posting_number: `JP-2026-${id}`,
    status: "PUBLISHED",
    ad_title: title,
    ad_body: null,
    apply_deadline: null,
    contact_email: null,
    last_edited_by_id: null,
    last_edited_at: null,
    is_accepting_applications: true,
    vacancy_request_id: `vr-${id}`,
    requisition_number: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function authWith(permissions: Permission[]) {
  mockedUseAuth.mockReturnValue({
    user: { role: "RECRUITMENT_OFFICER" } as UserRead,
    isLoading: false,
    login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    hasPermission: (permission: string) => permissions.includes(permission as Permission),
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <CampaignPosterPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function chooseSse() {
  await userEvent.click(await screen.findByRole("combobox", { name: "Campus" }));
  await userEvent.click(await screen.findByRole("option", { name: /^SSE/ }));
}

describe("CampaignPosterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authWith(["JOB_DISTRIBUTION"]);
    URL.createObjectURL = vi.fn(() => "blob:poster");
    URL.revokeObjectURL = vi.fn();
    mockedPoster.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    mockedList.mockResolvedValue([
      posting("1", "Electrician", { role_photo_enabled: true, has_role_photo: true }),
      posting("2", "Plumber", { has_role_photo: true }),
      posting("3", "Draft role", { status: "DRAFT" }),
      posting("4", "Lab Assistant", { campus_id: "c-scad", campus_code: "SCAD", campus_name: "SCAD" }),
    ]);
  });

  it("offers only published postings, and only from the chosen campus", async () => {
    renderPage();
    await chooseSse();

    expect(screen.getByText("Electrician")).toBeInTheDocument();
    expect(screen.getByText("Plumber")).toBeInTheDocument();
    expect(screen.queryByText("Draft role")).not.toBeInTheDocument();
    expect(screen.queryByText("Lab Assistant")).not.toBeInTheDocument();
    expect(screen.getByText("Photo on")).toBeInTheDocument();
    expect(screen.getByText("Photo not approved")).toBeInTheDocument();
  });

  it("sends the ticked postings with the ribbon title", async () => {
    const user = userEvent.setup();
    renderPage();
    await chooseSse();

    expect(screen.getByRole("button", { name: "Download poster (PDF)" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Electrician/ }));
    await user.click(screen.getByRole("checkbox", { name: /Plumber/ }));
    await user.type(screen.getByLabelText("Ribbon title"), "Join our maintenance team");
    expect(screen.getByText(/1 of the chosen role has no approved photo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download poster (PDF)" }));

    await waitFor(() =>
      expect(mockedPoster).toHaveBeenCalledWith(["1", "2"], { title: "Join our maintenance team", pitch: undefined }),
    );
  });

  it("stops at six roles, because one sheet cannot lay out a seventh", async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue(Array.from({ length: 7 }, (_, i) => posting(`${i}`, `Role ${i}`)));
    renderPage();
    await chooseSse();

    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("checkbox", { name: new RegExp(`Role ${i}`) }));
    expect(screen.getByRole("checkbox", { name: /Role 6/ })).toBeDisabled();
    expect(screen.getByText(/Six is the most one sheet can lay out/)).toBeInTheDocument();
  });

  it("surfaces the server's refusal", async () => {
    const user = userEvent.setup();
    mockedPoster.mockRejectedValue(new ApiError(409, "JP-2026-1 is not published"));
    renderPage();
    await chooseSse();

    await user.click(screen.getByRole("checkbox", { name: /Electrician/ }));
    await user.click(screen.getByRole("button", { name: "Download poster (PDF)" }));
    expect(await screen.findByText("JP-2026-1 is not published")).toBeInTheDocument();
  });

  it("says why there is nothing to do without the permission", () => {
    authWith([]);
    renderPage();
    expect(screen.getByText(/needs the job distribution permission/)).toBeInTheDocument();
    expect(mockedList).not.toHaveBeenCalled();
  });
});
