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
  departments: [
    // A department is a place, not a staff category: CSE employs Assistant
    // Professors and Lab Assistants at the same time.
    { id: "d-cse", name: "CSE", campus_id: "c-sse", supported_categories: ["TEACHING", "NON_TEACHING"] },
    { id: "d-phy", name: "Physics", campus_id: "c-sse", supported_categories: ["TEACHING"] },
  ],
  designations: [
    { id: "des-ap", name: "Assistant Professor", category: "TEACHING" },
    { id: "des-lab", name: "Lab Assistant", category: "NON_TEACHING" },
  ],
  locations: [
    {
      id: "loc-1",
      name: "CB Block",
      block_building: "Circular Building",
      floor_venue: "Ground Floor",
      campus_id: "c-sse",
    },
    // Same physical place, a second master-data row. Real data has six rows
    // all named "CB Block"; the picker must collapse them to one option.
    {
      id: "loc-2",
      name: "CB Block",
      block_building: "circular building",
      floor_venue: "ground floor",
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

async function pickOption(comboboxName: string, optionName: string | RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  await userEvent.click(await screen.findByRole("option", { name: optionName }));
}

/** The full valid path, defaulting to the Teaching designation. */
async function fillRequiredFields({ designation = "Assistant Professor", department = "CSE" } = {}) {
  await pickOption("Campus", /SSE/);
  await pickOption("Department", department);
  await pickOption("Designation", designation);
  await pickOption("Location", "Circular Building — Ground Floor");

  await userEvent.type(field("Justification"), "Two faculty are retiring this term.");
  await userEvent.type(field("Name"), "Priya Raman");
  await userEvent.type(field("Email"), "priya@example.com");
  await userEvent.type(field("Mobile"), "9876543210");
}

function submitButton() {
  return screen.getByRole("button", { name: "Submit request" });
}

/** Required fields render a visual "*" inside their <label>, and
 * getByLabelText matches a label by its TEXT CONTENT (aria-hidden does not
 * exclude it there), so the accessible label is "Justification *". Matching
 * the name plus an optional trailing star keeps these queries readable
 * without asserting on the marker. */
function field(name: string): HTMLElement {
  // Built by concatenation, not a template literal: `\s` inside a template
  // literal is an unrecognised escape that collapses to a plain "s".
  return screen.getByLabelText(new RegExp("^" + name + "\\s*\\*?$"));
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
    await userEvent.click(submitButton());

    expect(await screen.findByText("VR-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Request submitted successfully")).toBeInTheDocument();
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    // The reference is the backend's, never invented here.
    expect(screen.getByRole("button", { name: "Copy Request ID" })).toBeInTheDocument();
  });

  it("sends the chosen ids, not the labels", async () => {
    mockedSubmit.mockResolvedValue({ request_ref: "VR-2026-000124", status: "SUBMITTED", submitted_at: null });
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          campus_id: "c-sse",
          department_id: "d-cse",
          designation_id: "des-ap",
          location_id: "loc-1",
          number_of_positions: 1,
        }),
      ),
    );
  });

  it("labels locations by block and floor, not by the repeated name", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));

    expect(await screen.findByRole("option", { name: "Circular Building — Ground Floor" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "CB Block" })).not.toBeInTheDocument();
    // Two master-data rows for one physical place collapse to one option.
    expect(screen.getAllByRole("option", { name: /Circular Building/ })).toHaveLength(1);
  });

  it("clears department, designation and location when the campus changes", async () => {
    // All three depend on the campus (designation via the department's
    // supported categories). A stale selection would be submitted and refused
    // server-side for a reason not visible on screen.
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "CSE");
    await pickOption("Designation", "Assistant Professor");

    // Re-selecting the campus resets the dependent pickers.
    await pickOption("Campus", /SSE/);

    expect(submitButton()).toBeDisabled();
  });

  it("keeps Submit disabled until every required field is filled", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    expect(submitButton()).toBeDisabled();

    await fillRequiredFields();

    expect(submitButton()).toBeEnabled();
  });

  // --- Location, mandatory and category-blind (2026-09-02) ------------------

  it("blocks submission until a Location is chosen", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "CSE");
    await pickOption("Designation", "Assistant Professor");
    await userEvent.type(field("Justification"), "Two faculty are retiring this term.");
    await userEvent.type(field("Name"), "Priya Raman");
    await userEvent.type(field("Email"), "priya@example.com");
    await userEvent.type(field("Mobile"), "9876543210");

    // Everything else is valid; Location alone is missing.
    expect(submitButton()).toBeDisabled();

    await pickOption("Location", "Circular Building — Ground Floor");

    expect(submitButton()).toBeEnabled();
  });

  it("offers the same locations for a Non-Teaching designation as for a Teaching one", async () => {
    // A Location is a physical place -- a room does not stop existing because
    // the post is non-teaching. This is the regression guard for the class of
    // bug fixed in d28d72c, where a category filter left every NON_TEACHING
    // row with an empty dropdown.
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "CSE");
    await pickOption("Designation", "Lab Assistant");
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));

    expect(await screen.findByRole("option", { name: "Circular Building — Ground Floor" })).toBeInTheDocument();
  });

  it("submits a Non-Teaching request with a location", async () => {
    mockedSubmit.mockResolvedValue({ request_ref: "VR-2026-000200", status: "SUBMITTED", submitted_at: null });
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields({ designation: "Lab Assistant" });
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ designation_id: "des-lab", location_id: "loc-1" }),
      ),
    );
    expect(await screen.findByText("VR-2026-000200")).toBeInTheDocument();
  });

  // --- Category is derived, never asked for ---------------------------------

  it("never renders a Category field, and shows the derived category instead", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    expect(screen.queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument();

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "CSE");
    await pickOption("Designation", "Lab Assistant");

    expect(screen.getByText(/Category: Non-Teaching/)).toBeInTheDocument();
  });

  it("offers only the designations the chosen department supports", async () => {
    // A MEMBERSHIP test against supported_categories, never an equality test.
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "Physics");
    await userEvent.click(screen.getByRole("combobox", { name: "Designation" }));

    expect(await screen.findByRole("option", { name: "Assistant Professor" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Lab Assistant" })).not.toBeInTheDocument();
  });

  it("clears the designation when the department changes", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await pickOption("Campus", /SSE/);
    await pickOption("Department", "CSE");
    await pickOption("Designation", "Lab Assistant");
    expect(screen.getByText(/Category: Non-Teaching/)).toBeInTheDocument();

    // Physics does not support NON_TEACHING; the stale choice must not survive.
    await pickOption("Department", "Physics");

    expect(screen.queryByText(/Category: Non-Teaching/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  // --- Field validation ------------------------------------------------------

  it("rejects a justification that is too short", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await userEvent.type(field("Justification"), "short");

    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("rejects a whitespace-only justification", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.clear(field("Justification"));
    await userEvent.type(field("Justification"), "            ");

    expect(submitButton()).toBeDisabled();
  });

  it.each(["0", "-1", "1.5", "abc", "500"])("rejects a position count of %s", async (value) => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    const positions = field("Number of positions");
    await userEvent.clear(positions);
    await userEvent.type(positions, value);

    expect(submitButton()).toBeDisabled();
  });

  it("names the server's own cap when the count is too high", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    const positions = field("Number of positions");
    await userEvent.clear(positions);
    await userEvent.type(positions, "500");

    expect(screen.getByText(/from 1 to 100/i)).toBeInTheDocument();
  });

  it("rejects a required-by date in the past", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    expect(submitButton()).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Required by (optional)"), "2020-01-01");

    expect(screen.getByText(/cannot be in the past/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("rejects an invalid email", async () => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.clear(field("Email"));
    await userEvent.type(field("Email"), "priya.example.com");

    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it.each(["98765abcde", "5876543210", "987654321"])("rejects the mobile number %s", async (value) => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.clear(field("Mobile"));
    await userEvent.type(field("Mobile"), value);

    expect(screen.getByText(/valid 10-digit Indian mobile number/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it.each(["9876543210", "+91 98765 43210", "098765 43210"])("accepts the mobile number %s", async (value) => {
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.clear(field("Mobile"));
    await userEvent.type(field("Mobile"), value);

    expect(submitButton()).toBeEnabled();
  });

  // --- Submission behaviour --------------------------------------------------

  it("submits only once when the button is double-clicked", async () => {
    // Two identical submissions would be two real vacancy requests: the
    // backend creates rather than upserts, so nothing downstream collapses
    // them.
    let resolveSubmit: (value: publicApi.PublicVacancyRequestConfirmation) => void = () => {};
    mockedSubmit.mockImplementation(
      () => new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    const button = submitButton();
    await userEvent.click(button);
    await userEvent.click(button);

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();

    resolveSubmit({ request_ref: "VR-2026-000300", status: "SUBMITTED", submitted_at: null });
    expect(await screen.findByText("VR-2026-000300")).toBeInTheDocument();
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
    await userEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Only 0 posts available to request/);
    // The form is still on screen with the entered values intact.
    expect(submitButton()).toBeInTheDocument();
  });

  it("keeps every entered value and re-enables Submit when the network fails", async () => {
    mockedSubmit.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();
    await screen.findByText("Vacancy Request");

    await fillRequiredFields();
    await userEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    // Nothing was cleared, and the requester can fix one field and retry.
    expect(field("Name")).toHaveValue("Priya Raman");
    expect(field("Email")).toHaveValue("priya@example.com");
    expect(field("Justification")).toHaveValue("Two faculty are retiring this term.");
    expect(submitButton()).toBeEnabled();
  });
});
