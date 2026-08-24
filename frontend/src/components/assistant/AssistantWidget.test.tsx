import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as assistantApi from "@/api/assistant";
import { ApiError } from "@/api/client";
import type { AssistantQueryResponse, UserRead, UserRole } from "@/api/types";
import * as authContext from "@/auth/AuthContext";

import { AssistantWidget } from "./AssistantWidget";

vi.mock("@/api/assistant");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedQueryAssistant = vi.mocked(assistantApi.queryAssistant);
const mockedDownloadAssistantExport = vi.mocked(assistantApi.downloadAssistantExport);

function mockAuth(role: UserRole) {
  mockedUseAuth.mockReturnValue({
    user: { role, full_name: "Test User", campus_id: "c-1" } as UserRead,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(),
    mustChangePassword: false,
    completePasswordChange: vi.fn(),
  });
}

function renderWidget(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/dashboard" element={<AssistantWidget />} />
        <Route path="/sanctioned-strength" element={<div>Sanctioned Strength Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AssistantWidget", () => {
  it("renders the floating button for a non-candidate role", () => {
    mockAuth("HR_ADMIN");
    renderWidget();
    expect(screen.getByRole("button", { name: "Open assistant" })).toBeInTheDocument();
  });

  it("hides the floating button for a CANDIDATE-role user", () => {
    mockAuth("CANDIDATE");
    renderWidget();
    expect(screen.queryByRole("button", { name: "Open assistant" })).not.toBeInTheDocument();
  });

  it("opens the panel on click and shows suggested question chips", async () => {
    mockAuth("HR_ADMIN");
    const user = userEvent.setup();
    renderWidget();

    await user.click(screen.getByRole("button", { name: "Open assistant" }));

    expect(screen.getByRole("dialog", { name: "SIMATS Recruitment Assistant" })).toBeInTheDocument();
    expect(screen.getByText("How many vacancies are there currently?")).toBeInTheDocument();
  });

  it("sends a message and renders the response with an open_page action", async () => {
    mockAuth("HR_ADMIN");
    const response: AssistantQueryResponse = {
      answer: "There are **12** open vacancies.",
      tools_used: ["get_vacancy_summary"],
      actions: [{ type: "open_page", label: "Open Vacancy Register", path: "/sanctioned-strength", query: { category: "teaching" } }],
    };
    mockedQueryAssistant.mockResolvedValue(response);

    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    await user.click(screen.getByText("How many vacancies are there currently?"));

    expect(await screen.findByText(/12/)).toBeInTheDocument();
    expect(mockedQueryAssistant).toHaveBeenCalledWith("How many vacancies are there currently?", []);

    const actionButton = screen.getByRole("link", { name: /Open Vacancy Register/ });
    expect(actionButton).toHaveAttribute("href", "/sanctioned-strength?category=teaching");

    await user.click(actionButton);
    expect(await screen.findByText("Sanctioned Strength Page")).toBeInTheDocument();
    // Navigating via an open_page action closes the panel.
    expect(screen.queryByRole("dialog", { name: "SIMATS Recruitment Assistant" })).not.toBeInTheDocument();
  });

  it("renders an export_excel action and triggers a download", async () => {
    mockAuth("HR_ADMIN");
    mockedQueryAssistant.mockResolvedValue({
      answer: "Here is the vacancy report.",
      tools_used: ["get_campus_vacancy_report"],
      actions: [{ type: "export_excel", label: "Export Vacancies (Excel)", report_type: "vacancies", params: {} }],
    });
    mockedDownloadAssistantExport.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    await user.click(screen.getByText("Give me a complete recruitment report."));

    const exportButton = await screen.findByRole("button", { name: /Export Vacancies \(Excel\)/ });
    await user.click(exportButton);

    await waitFor(() => expect(mockedDownloadAssistantExport).toHaveBeenCalledWith("vacancies", {}));
    expect(await screen.findByText("Downloaded")).toBeInTheDocument();
  });

  it("shows a faithful inline error message on a failed query and allows retry", async () => {
    mockAuth("HR_ADMIN");
    // Relative call-count baseline, not an absolute literal -- this mock is
    // shared (not auto-cleared) across every `it` in this file, same
    // convention as e.g. VacancyRequestsListPage.test.tsx's
    // `callCountBeforeFilter`.
    const callsBefore = mockedQueryAssistant.mock.calls.length;
    mockedQueryAssistant
      .mockRejectedValueOnce(new ApiError(503, "AI features are not configured (ANTHROPIC_API_KEY is not set)"))
      .mockResolvedValueOnce({ answer: "12 open vacancies.", tools_used: [], actions: [] });

    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    await user.click(screen.getByText("How many vacancies are there currently?"));

    expect(
      await screen.findByText("AI features are not configured (ANTHROPIC_API_KEY is not set)"),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    await user.click(retryButton);

    expect(await screen.findByText("12 open vacancies.")).toBeInTheDocument();
    expect(mockedQueryAssistant).toHaveBeenCalledTimes(callsBefore + 2);
  });
});
