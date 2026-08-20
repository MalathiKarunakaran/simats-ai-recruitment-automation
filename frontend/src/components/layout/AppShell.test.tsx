import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import * as candidatesApi from "@/api/candidates";
import * as notificationsApi from "@/api/notifications";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import type { UserRead, UserRole } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import { CampusProvider } from "@/campus/CampusContext";
import { ThemeProvider } from "@/theme/ThemeContext";

// AppShell's header renders CampusSwitcher/GlobalSearch/NotificationBell,
// each of which fires its own useQuery -- mocked here purely to keep this
// test's console/network quiet, not because their behavior is under test.
vi.mock("@/api/campuses");
vi.mock("@/api/candidates");
vi.mock("@/api/notifications");
vi.mock("@/api/vacancyRequests");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);

// jsdom doesn't implement window.matchMedia -- ThemeProvider (mounted here
// because this is the first test to render AppShell directly, which nests
// ThemeToggle) calls it during its initial-theme resolution. Not something
// setup.ts polyfills globally (no other test needs it yet, unlike the Radix
// Select pointer-capture stubs), so it's mocked locally here.
window.matchMedia =
  window.matchMedia ||
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);

function mockAuth(role: UserRole) {
  mockedUseAuth.mockReturnValue({
    user: { role, full_name: "Test User", campus_id: "c-1" } as UserRead,
    isLoading: false,
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
    logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
  });
}

function renderShell() {
  vi.mocked(campusesApi.listCampuses).mockResolvedValue([]);
  vi.mocked(candidatesApi.listCandidates).mockResolvedValue([]);
  vi.mocked(notificationsApi.listNotifications).mockResolvedValue([]);
  vi.mocked(vacancyRequestsApi.listVacancyRequests).mockResolvedValue([]);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter>
          <CampusProvider>
            <AppShell>
              <div>Page content</div>
            </AppShell>
          </CampusProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("AppShell nav", () => {
  it("shows Sanctioned Strength in the Recruitment group, directly above Vacancy Requests, not in Administration", async () => {
    mockAuth("HR_ADMIN");
    renderShell();

    await waitFor(() => expect(screen.getByRole("link", { name: /Sanctioned Strength/ })).toBeInTheDocument());

    const nav = screen.getByRole("navigation");
    const groupLabels = Array.from(nav.querySelectorAll<HTMLElement>(".uppercase")).map((el) => el.textContent);
    expect(groupLabels).toContain("Recruitment");
    expect(groupLabels).toContain("Administration");

    // Recruitment group's own link order: Sanctioned Strength first, then
    // Vacancy Requests directly after it.
    const recruitmentHeading = Array.from(nav.querySelectorAll<HTMLElement>("div")).find(
      (el) => el.textContent === "Recruitment",
    );
    const recruitmentGroup = recruitmentHeading?.parentElement;
    expect(recruitmentGroup).toBeTruthy();
    const linkLabels = Array.from(recruitmentGroup!.querySelectorAll("a")).map((a) => a.textContent);
    expect(linkLabels[0]).toBe("Sanctioned Strength");
    expect(linkLabels[1]).toBe("Vacancy Requests");

    // Not present in the Administration group any more.
    const adminHeading = Array.from(nav.querySelectorAll<HTMLElement>("div")).find(
      (el) => el.textContent === "Administration",
    );
    const adminGroup = adminHeading?.parentElement;
    const adminLinkLabels = Array.from(adminGroup!.querySelectorAll("a")).map((a) => a.textContent);
    expect(adminLinkLabels).not.toContain("Sanctioned Strength");
  });

  it("points the Sanctioned Strength nav link at /sanctioned-strength", async () => {
    mockAuth("SUPER_ADMIN");
    renderShell();

    const link = await screen.findByRole("link", { name: /Sanctioned Strength/ });
    expect(link).toHaveAttribute("href", "/sanctioned-strength");
  });
});
