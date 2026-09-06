import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import { ApiError } from "@/api/client";
import * as channelsApi from "@/api/recruitmentChannels";
import type { CampusRead, ChannelRuleRead, RecruitmentChannelRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/toast";
import { RecruitmentChannelsPage } from "@/pages/RecruitmentChannelsPage";

vi.mock("@/api/recruitmentChannels");
vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListChannels = vi.mocked(channelsApi.listRecruitmentChannels);
const mockedListRules = vi.mocked(channelsApi.listChannelRules);
const mockedCreateChannel = vi.mocked(channelsApi.createRecruitmentChannel);
const mockedUpdateChannel = vi.mocked(channelsApi.updateRecruitmentChannel);
const mockedCreateRule = vi.mocked(channelsApi.createChannelRule);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

const SSE = { id: "c-sse", code: "SSE", name: "SIMATS Engineering", is_active: true } as CampusRead;

function channel(overrides: Partial<RecruitmentChannelRead> = {}): RecruitmentChannelRead {
  return {
    id: "ch-linkedin",
    code: "LINKEDIN",
    name: "LinkedIn",
    kind: "JOB_PORTAL",
    mode: "API",
    integration_path: "job-distribution",
    config: null,
    applicable_categories: [],
    applicable_campus_ids: [],
    is_active: true,
    display_order: 20,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const RULE: ChannelRuleRead = {
  id: "rule-1",
  name: "Teaching posts",
  is_active: true,
  priority: 100,
  match_category: "TEACHING",
  match_campus_id: null,
  match_department_id: null,
  match_designation_id: null,
  match_employment_type: null,
  channel_ids: ["ch-linkedin"],
  auto_select: false,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

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
        <RecruitmentChannelsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("RecruitmentChannelsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListChannels.mockResolvedValue([
      channel(),
      channel({ id: "ch-board", code: "FACULTYPLUS", name: "FacultyPlus", kind: "ACADEMIC_PORTAL", mode: "MANUAL_ASSISTED", integration_path: null, applicable_categories: ["TEACHING"], applicable_campus_ids: ["c-sse"], is_active: false, display_order: 50 }),
    ]);
    mockedListRules.mockResolvedValue([RULE]);
    mockedListCampuses.mockResolvedValue([SSE]);
  });

  it("lists channels with mode, categories and campuses, read-only for a role without the write gate", async () => {
    authAs("RECRUITMENT_OFFICER");
    renderPage();
    expect(await screen.findByText("LinkedIn")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("API (via n8n)")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText("All")).toHaveLength(2);
    expect(within(rows[1]).getByText("Manual")).toBeInTheDocument();
    expect(within(rows[1]).getByText("TEACHING")).toBeInTheDocument();
    expect(within(rows[1]).getByText("SSE")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("offers the write controls to a coordinator granted MANAGE_RECRUITMENT_CHANNELS", async () => {
    authAs("RECRUITMENT_COORDINATOR", ["MANAGE_RECRUITMENT_CHANNELS"]);
    renderPage();
    expect(await screen.findByRole("button", { name: "New channel" })).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  it("creates a channel with an upper-cased code and the fields the form collects", async () => {
    authAs("HR_ADMIN");
    mockedCreateChannel.mockResolvedValue(channel({ id: "ch-new", code: "NEWPORTAL", name: "New portal" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New channel" }));
    await userEvent.type(screen.getByLabelText("Code"), "newportal");
    await userEvent.type(screen.getByLabelText("Name"), "New portal");
    await userEvent.click(screen.getByRole("button", { name: "NON TEACHING" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedCreateChannel).toHaveBeenCalledWith({
        code: "NEWPORTAL",
        name: "New portal",
        kind: "JOB_PORTAL",
        mode: "API",
        integration_path: "job-distribution",
        applicable_categories: ["NON_TEACHING"],
        applicable_campus_ids: [],
        is_active: true,
        display_order: 100,
        notes: null,
      }),
    );
    expect(await screen.findByText("Channel saved.")).toBeInTheDocument();
  });

  it("refuses a malformed code before calling the server, and shows the server's own refusal", async () => {
    authAs("HR_ADMIN");
    mockedCreateChannel.mockRejectedValue(new ApiError(409, "A channel with this code already exists"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New channel" }));
    await userEvent.type(screen.getByLabelText("Code"), "bad code");
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Code must be letters/)).toBeInTheDocument();
    expect(mockedCreateChannel).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Code"));
    await userEvent.type(screen.getByLabelText("Code"), "LINKEDIN");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("A channel with this code already exists")).toBeInTheDocument();
  });

  it("toggles a channel's active switch straight to the server", async () => {
    authAs("SUPER_ADMIN");
    mockedUpdateChannel.mockResolvedValue(channel({ is_active: false }));
    renderPage();
    await userEvent.click(await screen.findByRole("switch", { name: "LINKEDIN active" }));
    await waitFor(() => expect(mockedUpdateChannel).toHaveBeenCalledWith("ch-linkedin", { is_active: false }));
  });

  it("lists rules on the Rules tab and creates one with picked channels", async () => {
    authAs("HR_ADMIN");
    mockedCreateRule.mockResolvedValue({ ...RULE, id: "rule-2", name: "Housekeeping" });
    renderPage();
    await screen.findByText("LinkedIn");
    await userEvent.click(await screen.findByText(/Rules \(1\)/));
    expect(await screen.findByText("Teaching posts")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New rule" }));
    await userEvent.type(screen.getByLabelText("Name"), "Housekeeping");
    // Picking no channel is refused client-side first.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Pick at least one channel.")).toBeInTheDocument();
    expect(mockedCreateRule).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LINKEDIN" }));
    await userEvent.click(screen.getByRole("switch", { name: "Auto-select" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedCreateRule).toHaveBeenCalledWith({
        name: "Housekeeping",
        priority: 100,
        match_category: null,
        match_campus_id: null,
        channel_ids: ["ch-linkedin"],
        auto_select: true,
        is_active: true,
        notes: null,
      }),
    );
  });
});
