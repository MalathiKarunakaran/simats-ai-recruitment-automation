import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as vacancyRequestsApi from "@/api/vacancyRequests";
import { VacancyRequestBulkUploadDialog } from "@/components/vacancyRequests/VacancyRequestBulkUploadDialog";

vi.mock("@/api/vacancyRequests");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(vacancyRequestsApi.validateVacancyRequestBulkUpload);
const mockedCommit = vi.mocked(vacancyRequestsApi.commitVacancyRequestBulkUpload);
const mockedTemplate = vi.mocked(vacancyRequestsApi.downloadVacancyRequestBulkUploadTemplate);

function row(overrides = {}) {
  return {
    row_number: 2,
    status: "created",
    error_reason: null,
    campus_code: "SSE",
    department_name: "CSE",
    designation_name: "Assistant Professor",
    requested_count: 2,
    priority: "NORMAL",
    required_by: null,
    justification: "Growth",
    ...overrides,
  };
}

function validation(overrides = {}) {
  return {
    total: 1,
    created_count: 1,
    // Always 0 -- this importer is create-only.
    updated_count: 0,
    unchanged_count: 0,
    rejected_count: 0,
    rows: [row()],
    ...overrides,
  };
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VacancyRequestBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload() {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload requests" }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "requests.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await userEvent.upload(input, file);
  return file;
}

describe("VacancyRequestBulkUploadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTemplate.mockResolvedValue(undefined);
  });

  it("previews rows after choosing a file, without committing", async () => {
    mockedValidate.mockResolvedValue(validation() as never);
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText(/1 rows: 1 created, 0 rejected/)).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    // Validate is a preview -- nothing is written until Commit is pressed.
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it("never offers Updated or Unchanged filters, which this importer cannot produce", async () => {
    mockedValidate.mockResolvedValue(validation() as never);
    renderDialog();
    await openAndUpload();
    await screen.findByText(/1 created/);

    await userEvent.click(screen.getByRole("combobox", { name: "Bulk upload row status filter" }));

    expect(await screen.findByRole("option", { name: "Created" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Rejected" })).toBeInTheDocument();
    // Permanently-empty options would imply behaviour the backend refuses to
    // have: a vacancy request is an event, so nothing is ever upserted.
    expect(screen.queryByRole("option", { name: "Updated" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Unchanged" })).not.toBeInTheDocument();
  });

  it("commits the same file that was validated", async () => {
    mockedValidate.mockResolvedValue(validation() as never);
    mockedCommit.mockResolvedValue({
      ...validation(),
      bulk_upload_log_id: "log-1",
      storage_warning: null,
    } as never);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText(/1 created/);
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    // The backend re-validates defensively rather than caching parsed rows,
    // so the identical File must be re-sent.
    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/1 draft request created/)).toBeInTheDocument();
  });

  it("shows a rejected row's reason in full, not behind a scrollbar", async () => {
    mockedValidate.mockResolvedValue(
      validation({
        created_count: 0,
        rejected_count: 1,
        rows: [row({ status: "rejected", error_reason: "CSE does not support HOUSEKEEPING designations." })],
      }) as never,
    );
    renderDialog();

    await openAndUpload();

    expect(
      await screen.findByText("CSE does not support HOUSEKEEPING designations."),
    ).toBeInTheDocument();
  });

  it("disables Commit when every row was rejected", async () => {
    // Committing would write nothing; offering the button suggests otherwise.
    mockedValidate.mockResolvedValue(
      validation({
        created_count: 0,
        rejected_count: 1,
        rows: [row({ status: "rejected", error_reason: "Unknown campus code 'XXX'." })],
      }) as never,
    );
    renderDialog();

    await openAndUpload();

    expect(await screen.findByRole("button", { name: "Commit" })).toBeDisabled();
  });

  it("offers the error report only when something was rejected", async () => {
    mockedValidate.mockResolvedValue(validation() as never);
    mockedCommit.mockResolvedValue({
      ...validation(),
      bulk_upload_log_id: "log-1",
      storage_warning: null,
    } as never);
    renderDialog();

    await openAndUpload();
    await screen.findByText(/1 created/);
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText(/1 draft request created/);

    expect(screen.queryByRole("button", { name: "Download error report" })).not.toBeInTheDocument();
  });

  it("shows a storage warning as a warning, not as a failure", async () => {
    // The rows genuinely committed; only the workbook archival failed.
    mockedValidate.mockResolvedValue(validation() as never);
    mockedCommit.mockResolvedValue({
      ...validation(),
      bulk_upload_log_id: "log-1",
      storage_warning: "Workbook storage is temporarily unavailable.",
    } as never);
    renderDialog();

    await openAndUpload();
    await screen.findByText(/1 created/);
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(await screen.findByText(/1 draft request created/)).toBeInTheDocument();
    expect(screen.getByText("Workbook storage is temporarily unavailable.")).toBeInTheDocument();
  });

  it("surfaces a validation failure without showing a preview", async () => {
    mockedValidate.mockRejectedValue(new ApiError(400, "File has 6000 rows; the limit is 5000."));
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("File has 6000 rows; the limit is 5000.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commit" })).not.toBeInTheDocument();
  });
});
