import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { CampusRead, DepartmentRead } from "@/api/types";
import * as usersApi from "@/api/users";
import { DepartmentScopeCard } from "@/components/users/DepartmentScopeCard";

vi.mock("@/api/users");

const mockedGet = vi.mocked(usersApi.getUserDepartmentScope);
const mockedSet = vi.mocked(usersApi.setUserDepartmentScope);

const CAMPUSES = [
  { id: "c-sse", code: "SSE", name: "SIMATS Engineering", is_active: true },
  { id: "c-scad", code: "SCAD", name: "Dental", is_active: true },
] as CampusRead[];
const DEPARTMENTS = [
  { id: "d-cse", campus_id: "c-sse", name: "Computer Science", is_active: true },
  { id: "d-ece", campus_id: "c-sse", name: "Electronics", is_active: true },
  { id: "d-old", campus_id: "c-sse", name: "Retired dept", is_active: false },
  { id: "d-dent", campus_id: "c-scad", name: "Orthodontics", is_active: true },
] as DepartmentRead[];

function renderCard(props: Partial<Parameters<typeof DepartmentScopeCard>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DepartmentScopeCard
        userId="u-1"
        targetRole="RECRUITMENT_COORDINATOR"
        viewerIsSuperAdmin
        campuses={CAMPUSES}
        departments={DEPARTMENTS}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("DepartmentScopeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue({ department_ids: [] });
  });

  it("renders nothing for a viewer who is not a Super Admin, or a target role that cannot be scoped", () => {
    const { container: a } = renderCard({ viewerIsSuperAdmin: false });
    expect(a).toBeEmptyDOMElement();
    const { container: b } = renderCard({ targetRole: "CAMPUS_HOD" });
    expect(b).toBeEmptyDOMElement();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("groups active departments by campus, hides retired ones, and explains an empty scope", async () => {
    renderCard();
    expect(await screen.findByText(/No restriction/)).toBeInTheDocument();
    expect(await screen.findByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("SCAD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Computer Science" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Retired dept" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save department scope" })).toBeDisabled();
  });

  it("saves the selection as a full replace and reflects the server's answer", async () => {
    mockedGet.mockResolvedValue({ department_ids: ["d-cse"] });
    mockedSet.mockResolvedValue({ department_ids: ["d-cse", "d-dent"] });
    renderCard();
    expect(await screen.findByText(/Restricted to 1 department\b/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Computer Science" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Orthodontics" }));
    await userEvent.click(screen.getByRole("button", { name: "Save department scope" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("u-1", ["d-cse", "d-dent"]));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText(/Restricted to 2 departments/)).toBeInTheDocument();
  });

  it("clears the restriction and shows the backend's refusal verbatim", async () => {
    mockedGet.mockResolvedValue({ department_ids: ["d-cse"] });
    mockedSet.mockRejectedValue(new ApiError(400, "This role cannot be department-scoped"));
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Clear restriction" }));
    expect(screen.getByText(/No restriction/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save department scope" }));
    await waitFor(() => expect(mockedSet).toHaveBeenCalledWith("u-1", []));
    expect(await screen.findByText("This role cannot be department-scoped")).toBeInTheDocument();
  });
});
