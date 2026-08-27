import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as designationsApi from "@/api/designations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { DesignationBulkUploadCommitResponse, DesignationBulkUploadValidationResponse } from "@/api/types";
import { DesignationBulkUploadDialog } from "@/components/designations/DesignationBulkUploadDialog";

// Sibling of components/departments/DepartmentBulkUploadDialog.test.tsx --
// same flow, own row shape/API module. downloadSanctionedStrengthBulkUploadErrorReport
// is mocked from api/sanctionedStrength.ts (not api/designations.ts) since
// DesignationBulkUploadDialog reuses that shared function directly rather
// than duplicating it (see the component's own docstring).

vi.mock("@/api/designations");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(designationsApi.validateDesignationBulkUpload);
const mockedCommit = vi.mocked(designationsApi.commitDesignationBulkUpload);
const mockedDownloadTemplate = vi.mocked(designationsApi.downloadDesignationBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: DesignationBulkUploadValidationResponse = {
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
      name: "Assistant Professor",
      category: "TEACHING",
      department_codes: ["CSE", "MECH"],
      qualification: "PhD",
      min_experience: "2+ years",
      employment_type: "FULL_TIME",
      required_skills: "MATLAB",
      is_active: true,
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown Department Code(s): ZZZ",
      name: "Lab Assistant",
      category: "NON_TEACHING",
      department_codes: ["ZZZ"],
      qualification: null,
      min_experience: null,
      employment_type: null,
      required_skills: null,
      is_active: null,
    },
  ],
};

const COMMIT_RESULT: DesignationBulkUploadCommitResponse = {
  ...VALIDATION_RESULT,
  bulk_upload_log_id: "bu-1",
  storage_warning: null,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DesignationBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("DesignationBulkUploadDialog", () => {
  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with Designation-shaped columns", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected.")).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    // department_codes is a list, joined for display.
    expect(screen.getByText("CSE, MECH")).toBeInTheDocument();
    expect(screen.getByText("MATLAB")).toBeInTheDocument();
    expect(screen.getByText("Unknown Department Code(s): ZZZ")).toBeInTheDocument();
  });

  it("commits the same file re-sent to /commit and shows the committed result with an error-report download", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText("Assistant Professor");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/Upload committed\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download error report" }));
    // The shared, entity-agnostic error-report endpoint -- reused verbatim,
    // not a Designation-specific duplicate.
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
    await screen.findByText("Assistant Professor");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(
      await screen.findByText("Upload committed. 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Workbook storage is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Commit failed")).not.toBeInTheDocument();
  });

  it("surfaces a validation failure inline instead of showing a preview", async () => {
    mockedValidate.mockRejectedValue(new Error("Only .xlsx or .csv files are accepted"));
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
  });

  it("leads the commit success message with 'Successfully imported N designation(s).'", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    await openAndUpload();
    await screen.findByText("Assistant Professor");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    // created_count (1) + updated_count (0) = 1 designation imported.
    expect(await screen.findByText("Successfully imported 1 designation.")).toBeInTheDocument();
  });

  it("pluralizes 'designations' in the summary sentence when more than one row is imported", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue({ ...COMMIT_RESULT, created_count: 2, updated_count: 1 });
    renderDialog();

    await openAndUpload();
    await screen.findByText("Assistant Professor");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(await screen.findByText("Successfully imported 3 designations.")).toBeInTheDocument();
  });

  it("displays NON_TEACHING as 'NON-TEACHING' (hyphen) in the preview table", async () => {
    mockedValidate.mockResolvedValue({
      ...VALIDATION_RESULT,
      rows: [{ ...VALIDATION_RESULT.rows[0], category: "NON_TEACHING" }],
    });
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("NON-TEACHING")).toBeInTheDocument();
  });

  it("disables Commit until a file has been validated with at least one row", async () => {
    mockedValidate.mockResolvedValue({ ...VALIDATION_RESULT, total: 0, created_count: 0, rejected_count: 0, rows: [] });
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("No rows in this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});
