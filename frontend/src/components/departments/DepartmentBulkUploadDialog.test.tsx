import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as departmentsApi from "@/api/departments";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { DepartmentBulkUploadCommitResponse, DepartmentBulkUploadValidationResponse } from "@/api/types";
import { DepartmentBulkUploadDialog } from "@/components/departments/DepartmentBulkUploadDialog";

// Sibling of components/locations/LocationBulkUploadDialog.test.tsx -- same
// flow, own row shape/API module. downloadSanctionedStrengthBulkUploadErrorReport
// is mocked from api/sanctionedStrength.ts (not api/departments.ts) since
// DepartmentBulkUploadDialog reuses that shared function directly rather
// than duplicating it (see the component's own docstring).

vi.mock("@/api/departments");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(departmentsApi.validateDepartmentBulkUpload);
const mockedCommit = vi.mocked(departmentsApi.commitDepartmentBulkUpload);
const mockedDownloadTemplate = vi.mocked(departmentsApi.downloadDepartmentBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: DepartmentBulkUploadValidationResponse = {
  total: 2,
  created_count: 1,
  updated_count: 0,
  unchanged_count: 0,
  rejected_count: 1,
  rows: [
    {
      row_number: 2,
      status: "created",
      error_reason: null,
      campus_code: "SSE",
      department_code: "PHY",
      department_name: "Physics",
      category: "TEACHING",
      parent_group: "School of Sciences",
      description: null,
      is_active: true,
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown campus code",
      campus_code: "ZZZ",
      department_code: "CHEM",
      department_name: "Chemistry",
      category: null,
      parent_group: null,
      description: null,
      is_active: null,
    },
  ],
};

const COMMIT_RESULT: DepartmentBulkUploadCommitResponse = {
  ...VALIDATION_RESULT,
  bulk_upload_log_id: "bu-1",
  storage_warning: null,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DepartmentBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("DepartmentBulkUploadDialog", () => {
  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with Department-shaped columns", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("School of Sciences")).toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
  });

  it("commits the same file re-sent to /commit and shows the committed result with an error-report download", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText("Physics");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/Upload committed\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download error report" }));
    // The shared, entity-agnostic error-report endpoint -- reused verbatim,
    // not a Department-specific duplicate.
    await waitFor(() => expect(mockedDownloadErrorReport).toHaveBeenCalledWith("bu-1"));
  });

  it("commits successfully and shows a non-blocking warning when the workbook could not be archived", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue({
      ...COMMIT_RESULT,
      storage_warning:
        "Workbook storage is temporarily unavailable. The file was successfully parsed, " +
        "but the original workbook could not be archived.",
    });
    renderDialog();

    await openAndUpload();
    await screen.findByText("Physics");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    // The real outcome (rows committed) still renders as success, not error.
    expect(
      await screen.findByText("Upload committed. 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    // The storage failure is a distinct, non-blocking warning alongside it.
    expect(
      screen.getByText(/Workbook storage is temporarily unavailable/),
    ).toBeInTheDocument();
    // Never rendered as the destructive-red `error` state.
    expect(screen.queryByText("Commit failed")).not.toBeInTheDocument();
  });

  it("surfaces a validation failure inline instead of showing a preview", async () => {
    mockedValidate.mockRejectedValue(new Error("Only .xlsx or .csv files are accepted"));
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
  });

  it("disables Commit until a file has been validated with at least one row", async () => {
    mockedValidate.mockResolvedValue({ ...VALIDATION_RESULT, total: 0, created_count: 0, rejected_count: 0, rows: [] });
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("No rows in this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});
