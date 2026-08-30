import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as publicApi from "@/api/publicVacancyRequests";
import { PublicVacancyRequestPage } from "@/pages/PublicVacancyRequestPage";

vi.mock("@/api/publicVacancyRequests");

const mockedGetOptions = vi.mocked(publicApi.getPublicFormOptions);
const mockedSubmit = vi.mocked(publicApi.submitPublicVacancyRequest);

const OPTIONS = {
  campuses: [{ id: "c-sse", code: "SSE", name: "Saveetha School of Engineering" }],
  departments: [{ id: "d-cse", name: "CSE", campus_id: "c-sse" }],
  designations: [{ id: "des-ap", name: "Assistant Professor", category: "TEACHING" }],
  locations: [
    {
      id: "loc-1",
      name: "CB Block",
      block_building: "Circular Building",
      floor_venue: "Ground Floor",
      campus_id: "c-sse",
    },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Deliberately NO MemoryRouter and no auth provider: this page must render
  // standalone, because it is mounted outside ProtectedRoute and AppShell.
  return render(
    <QueryClientProvider client={client}>
      <PublicVacancyRequestPage />
    </QueryClientProvider>,
  );
}

async function fillRequiredFields() {
  await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
  await userEvent.click(await screen.findByRole("option", { name: /SSE/ }));
  await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
  await userEvent.click(await screen.findByRole("option", { name: "CSE" }));
  await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));
  await userEvent.click(await screen.findByRole("option", { name: "Assistant Professor" }));

  await userEvent.type(screen.getByLabelText("Justification"), "Two faculty are retiring this term.");
  await userEvent.type(screen.getByLabelText("Name"), "Priya Raman");
  await userEvent.type(screen.getByLabelText("Email"), "priya@example.com");
  await userEvent.type(screen.getByLabelText("Mobile"), "9876543210");
}

describe("PublicVacancyRequestPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOptions.mockResolvedValue(OPTIONS as never);
  });

  it("renders standalone, with no navigation into the authenticated app", async () => {
    renderPage();

    expect(await screen.findByText("Vacancy Request")).toBeInTheDocument();
    expect(screen.getByText("SIMATS Recruitment")).toBeInTheDocument();
    // A visitor who scans the poster should not learn the rest of the app
    // exists, let alone be offered a way in.
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in|login/i })).not.toBeInTheDocument();
  });

  it("submits the form and shows the Request ID back", async () => {
    mockedSubmit.mockResolvedValue({
      request_ref: "VR-2026-000123",
      status: "SUBMITTED",
      submitted_at: "2026-08-30T10:00:00Z",
    });
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("VR-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Request submitted successfully")).toBeInTheDocument();
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
  });

  it("sends the chosen ids, not the labels", async () => {
    mockedSubmit.mockResolvedValue({ request_ref: "VR-2026-000124", status: "SUBMITTED", submitted_at: null });
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          campus_id: "c-sse",
          department_id: "d-cse",
          designation_id: "des-ap",
          number_of_positions: 1,
        }),
      ),
    );
  });

  it("labels locations by block and floor, not by the repeated name", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: /SSE/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));

    expect(await screen.findByRole("option", { name: "Circular Building — Ground Floor" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "CB Block" })).not.toBeInTheDocument();
  });

  it("clears department and location when the campus changes", async () => {
    // Both are campus-scoped. A stale selection would be submitted and
    // refused server-side for a reason not visible on screen.
    mockedSubmit.mockResolvedValue({ request_ref: "VR-1", status: "SUBMITTED", submitted_at: null });
    renderPage();
    await screen.findByText("Vacancy Request");

    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: /SSE/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    await userEvent.click(await screen.findByRole("option", { name: "CSE" }));

    // Re-selecting the campus resets the dependent pickers.
    await userEvent.click(screen.getByRole("combobox", { name: "Campus" }));
    await userEvent.click(await screen.findByRole("option", { name: /SSE/ }));

    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });

  it("keeps Submit disabled until every required field is filled", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();

    await fillRequiredFields();

    expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled();
  });

  it("rejects a justification that is too short", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await userEvent.type(screen.getByLabelText("Justification"), "short");

    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });

  it("rejects a position count above the server's own cap", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    const positions = screen.getByLabelText("Number of positions");
    await userEvent.clear(positions);
    await userEvent.type(positions, "500");

    expect(screen.getByText(/from 1 to 100/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });

  it("shows the server's own refusal verbatim rather than a generic message", async () => {
    // The sanction-ceiling refusal is specific and actionable; replacing it
    // with "Something went wrong" would leave the requester with no next step.
    mockedSubmit.mockRejectedValue(
      new ApiError(409, "Only 0 posts available to request for this designation. Raise a sanction revision first."),
    );
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Only 0 posts available to request/);
    // The form is still on screen with the entered values intact.
    expect(screen.getByRole("button", { name: "Submit request" })).toBeInTheDocument();
  });
});
