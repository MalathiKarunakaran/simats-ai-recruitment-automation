import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as migrationApi from "@/api/migration";
import type { TrackerImportResponse, UserRead } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { TrackerImportPage } from "@/pages/TrackerImportPage";

vi.mock("@/api/migration");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedImportTrackerWorkbook = vi.mocked(migrationApi.importTrackerWorkbook);
const mockedDownloadTrackerTemplate = vi.mocked(migrationApi.downloadTrackerTemplate);

const RESULT: TrackerImportResponse = {
  vacancy_total_rows: 1,
  vacancy_imported_count: 1,
  vacancy_flagged_count: 0,
  vacancy_rows: [{ row_number: 2, status: "imported", errors: [], vacancy_request_id: "vr-1" }],
  candidate_total_rows: 1,
  candidate_imported_count: 1,
  candidate_flagged_count: 0,
  candidate_rows: [{ row_number: 2, status: "imported", errors: [], application_id: "app-1" }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrackerImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TrackerImportPage", () => {
  it("blocks a role that isn't HR Admin/Super Admin from importing", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });

    renderPage();

    expect(
      screen.getByText("Only an HR Admin or Super Admin can import the recruitment tracker workbook."),
    ).toBeInTheDocument();
  });

  it("uploads a workbook without the sample row by default and renders results", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockResolvedValue(RESULT);

    renderPage();

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(mockedImportTrackerWorkbook).toHaveBeenCalledWith(file, false));
    await waitFor(() => expect(screen.getByText(/Vacancy Tracker: 1 imported/)).toBeInTheDocument());
    expect(screen.getByText(/Candidate Pipeline: 1 imported/)).toBeInTheDocument();
  });

  it("passes includeSample=true once the sample-row checkbox is checked", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "SUPER_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockResolvedValue(RESULT);

    renderPage();

    await userEvent.click(screen.getByRole("checkbox"));

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(mockedImportTrackerWorkbook).toHaveBeenCalledWith(file, true));
  });

  it("surfaces an import error instead of silently failing", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockRejectedValue(new Error("Only .xlsx files are accepted"));

    renderPage();

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(screen.getByText("Import failed")).toBeInTheDocument());
  });

  it("renders a warning-colored badge (not destructive) for imported_with_warning rows, distinct from flagged", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockResolvedValue({
      vacancy_total_rows: 3,
      vacancy_imported_count: 2,
      vacancy_flagged_count: 1,
      vacancy_rows: [
        { row_number: 2, status: "imported", errors: [], vacancy_request_id: "vr-1" },
        {
          row_number: 3,
          status: "imported_with_warning",
          errors: ["Designation 'Asst Prof' did not match Designation Master"],
          vacancy_request_id: "vr-2",
        },
        { row_number: 4, status: "flagged", errors: ["Unknown Campus 'ZZZ'"], vacancy_request_id: null },
      ],
      candidate_total_rows: 0,
      candidate_imported_count: 0,
      candidate_flagged_count: 0,
      candidate_rows: [],
    });

    renderPage();

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    expect(await screen.findByText("imported (warning)")).toBeInTheDocument();
    expect(screen.getByText("flagged")).toBeInTheDocument();
    // The warning row still links to its created vacancy (unlike the hard-flagged row).
    const links = screen.getAllByText("View vacancy");
    expect(links).toHaveLength(2);
    expect(screen.getByText("Designation 'Asst Prof' did not match Designation Master")).toBeInTheDocument();
    expect(screen.getByText("Unknown Campus 'ZZZ'")).toBeInTheDocument();
  });

  it("filters each result table independently by row status", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockResolvedValue({
      vacancy_total_rows: 2,
      vacancy_imported_count: 1,
      vacancy_flagged_count: 1,
      vacancy_rows: [
        { row_number: 2, status: "imported", errors: [], vacancy_request_id: "vr-1" },
        { row_number: 3, status: "flagged", errors: ["Unknown Campus 'ZZZ'"], vacancy_request_id: null },
      ],
      candidate_total_rows: 2,
      candidate_imported_count: 1,
      candidate_flagged_count: 1,
      candidate_rows: [
        { row_number: 2, status: "imported", errors: [], application_id: "app-1" },
        { row_number: 3, status: "flagged", errors: ["Unknown Source 'ZZZ'"], application_id: null },
      ],
    });

    renderPage();

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    await screen.findByText("View vacancy");
    expect(screen.getByText("Unknown Campus 'ZZZ'")).toBeInTheDocument();

    // Narrowing the Vacancy Tracker filter to Flagged hides row 2's link but
    // leaves the untouched Candidate Pipeline table showing both its rows.
    await userEvent.click(screen.getByRole("combobox", { name: "Vacancy Tracker status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Flagged" }));

    expect(screen.queryByText("View vacancy")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown Campus 'ZZZ'")).toBeInTheDocument();
    expect(screen.getByText("View application")).toBeInTheDocument();
    expect(screen.getByText("Unknown Source 'ZZZ'")).toBeInTheDocument();

    // Narrowing to Imported on the Vacancy table with no imported rows left
    // shows the "no rows match" message instead of an empty table.
    await userEvent.click(screen.getByRole("combobox", { name: "Vacancy Tracker status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Imported" }));
    expect(screen.queryByText("Unknown Campus 'ZZZ'")).not.toBeInTheDocument();
    expect(screen.getByText("View vacancy")).toBeInTheDocument();
  });

  it("resets both status filters back to All on a fresh import", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedImportTrackerWorkbook.mockResolvedValue({
      vacancy_total_rows: 2,
      vacancy_imported_count: 1,
      vacancy_flagged_count: 1,
      vacancy_rows: [
        { row_number: 2, status: "imported", errors: [], vacancy_request_id: "vr-1" },
        { row_number: 3, status: "flagged", errors: ["Unknown Campus 'ZZZ'"], vacancy_request_id: null },
      ],
      candidate_total_rows: 0,
      candidate_imported_count: 0,
      candidate_flagged_count: 0,
      candidate_rows: [],
    });

    renderPage();

    const file = new File(["dummy"], "tracker.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    await screen.findByText("View vacancy");

    await userEvent.click(screen.getByRole("combobox", { name: "Vacancy Tracker status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Flagged" }));
    expect(screen.queryByText("View vacancy")).not.toBeInTheDocument();

    // Re-uploading (a second run of the same or a different workbook) should
    // land back on "All rows" rather than carrying the stale filter forward.
    // Vitest doesn't clear mocks between tests in this file, so compare
    // against the pre-reupload call count rather than an absolute value.
    const callsBeforeReupload = mockedImportTrackerWorkbook.mock.calls.length;
    await userEvent.upload(fileInput, file);
    await waitFor(() =>
      expect(mockedImportTrackerWorkbook.mock.calls.length).toBe(callsBeforeReupload + 1),
    );
    expect(await screen.findByText("View vacancy")).toBeInTheDocument();
  });

  it("downloads the workbook template", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(),
    });
    mockedDownloadTrackerTemplate.mockResolvedValue(undefined);

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Download workbook template" }));

    await waitFor(() => expect(mockedDownloadTrackerTemplate).toHaveBeenCalled());
  });
});
