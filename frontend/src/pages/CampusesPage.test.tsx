import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as campusesApi from "@/api/campuses";
import type { CampusRead, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { CampusesPage } from "@/pages/CampusesPage";

vi.mock("@/api/campuses");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedListCampuses = vi.mocked(campusesApi.listCampuses);
const mockedCreateCampus = vi.mocked(campusesApi.createCampus);
const mockedUpdateCampus = vi.mocked(campusesApi.updateCampus);

function mockUser(role: UserRead["role"]) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u-1", role, campus_id: null } as UserRead,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

const SSE: CampusRead = {
  id: "c-sse",
  code: "SSE",
  name: "Saveetha School of Engineering",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// SHOTS removed 2026-08-06 (confirmed a duplicate of SHIFT) -- still 7
// codes, just a different 7 than the original seed set.
const ALL_SEVEN_CAMPUSES: CampusRead[] = [
  "SSE",
  "SCLAS",
  "SCAD",
  "STUDIO",
  "SPIER",
  "SSPE",
  "SHIFT",
].map((code) => ({ ...SSE, id: `c-${code}`, code: code as CampusRead["code"] }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CampusesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CampusesPage", () => {
  it("lists campuses with code, name, and active status", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, { ...SSE, id: "c-shift", code: "SHIFT", is_active: false }]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.getByText("SHIFT")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });

  it("hides New campus and Edit for a non-Super-Admin role", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New campus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("disables New campus once all 7 institutional codes are already in use", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue(ALL_SEVEN_CAMPUSES);

    renderPage();

    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New campus" })).toBeDisabled();
  });

  it("creates a new campus from an available code", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedCreateCampus.mockResolvedValue({ ...SSE, id: "c-scad", code: "SCAD" });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "New campus" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "New campus" }));
    // Two comboboxes in the dialog: the institutional code Select, then Active.
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "SCAD" }));
    await userEvent.type(screen.getByLabelText("Name"), "SCAD Campus");
    await userEvent.click(screen.getByRole("button", { name: "Create campus" }));

    await waitFor(() =>
      expect(mockedCreateCampus).toHaveBeenCalledWith({ code: "SCAD", name: "SCAD Campus", is_active: true }),
    );
  });

  it("edits an existing campus's name without changing its code", async () => {
    mockUser("SUPER_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE]);
    mockedUpdateCampus.mockResolvedValue({ ...SSE, name: "SSE (renamed)" });

    renderPage();
    await waitFor(() => expect(screen.getByText("SSE")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "SSE (renamed)");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockedUpdateCampus).toHaveBeenCalledWith("c-sse", { name: "SSE (renamed)", is_active: true }),
    );
  });

  it("narrows the list with the active filter", async () => {
    mockUser("HR_ADMIN");
    mockedListCampuses.mockResolvedValue([SSE, { ...SSE, id: "c-shift", code: "SHIFT", is_active: false }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("SHIFT")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("combobox", { name: "Active filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Active" }));

    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.queryByText("SHIFT")).not.toBeInTheDocument();
  });
});
