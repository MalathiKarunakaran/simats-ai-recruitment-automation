import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import type { UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CampusProvider } from "@/campus/CampusContext";
import { CampusSwitcher } from "@/components/layout/CampusSwitcher";

vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);

const CAMPUSES = [
  { id: "c-sse", code: "SSE" as const, name: "Saveetha School of Engineering", is_active: true, created_at: "", updated_at: "" },
  { id: "c-scad", code: "SCAD" as const, name: "Saveetha College of Architecture and Design", is_active: true, created_at: "", updated_at: "" },
];

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("CampusSwitcher", () => {
  it("shows a locked label (not a dropdown) for a single-campus role", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD", campus_id: "c-sse" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);

    render(
      <Wrapper>
        <CampusProvider>
          <CampusSwitcher />
        </CampusProvider>
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText(/SSE/)).toBeInTheDocument());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows an interactive dropdown for a global-scope role", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN", campus_id: null } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedListCampuses.mockResolvedValue(CAMPUSES);

    render(
      <Wrapper>
        <CampusProvider>
          <CampusSwitcher />
        </CampusProvider>
      </Wrapper>,
    );

    const trigger = await screen.findByRole("combobox");
    await userEvent.click(trigger);
    expect(await screen.findByRole("option", { name: /SSE/ })).toBeInTheDocument();
  });
});
