import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { BulkUploadCommitResponse, BulkUploadValidationResponse } from "@/api/types";
import { BulkUploadDialog } from "@/components/sanctionedStrength/BulkUploadDialog";

vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(sanctionedStrengthApi.validateSanctionedStrengthBulkUpload);
const mockedCommit = vi.mocked(sanctionedStrengthApi.commitSanctionedStrengthBulkUpload);
const mockedDownloadTemplate = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: BulkUploadValidationResponse = {
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
      department_name: "Computer Science",
      designation_name: "Assistant Professor",
      approved_strength: 10,
      effective_from: "2026-08-01",
      remarks: null,
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown campus code",
      campus_code: "ZZZ",
      department_name: "Computer Science",
      designation_name: "Professor",
      approved_strength: 5,
      effective_from: "2026-08-01",
      remarks: null,
    },
  ],
};

const COMMIT_RESULT: BulkUploadCommitResponse = {
  ...VALIDATION_RESULT,
  bulk_upload_log_id: "bu-1",
  storage_warning: null,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("BulkUploadDialog", () => {
  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with summary counts and status badges", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
  });

  it("filters preview rows by status", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();
    await openAndUpload();
    await screen.findByText("Created");

    await userEvent.click(screen.getByRole("combobox", { name: "Bulk upload row status filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Rejected" }));

    expect(screen.queryByText("Assistant Professor")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
  });

  it("commits the same file re-sent to /commit and shows the committed result with an error-report download", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText("Created");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/Upload committed\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download error report" }));
    await waitFor(() => expect(mockedDownloadErrorReport).toHaveBeenCalledWith("bu-1"));
  });

  it("does not offer an error-report download once committed with zero rejected rows", async () => {
    const cleanValidation: BulkUploadValidationResponse = {
      total: 1,
      created_count: 1,
      updated_count: 0,
      unchanged_count: 0,
      rejected_count: 0,
      rows: [
        {
          row_number: 2,
          status: "created",
          error_reason: null,
          campus_code: "SSE",
          department_name: "Computer Science",
          designation_name: "Assistant Professor",
          approved_strength: 10,
          effective_from: "2026-08-01",
          remarks: null,
        },
      ],
    };
    mockedValidate.mockResolvedValue(cleanValidation);
    mockedCommit.mockResolvedValue({ ...cleanValidation, bulk_upload_log_id: "bu-2", storage_warning: null });
    renderDialog();

    await openAndUpload();
    await screen.findByText("Created");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await screen.findByText(/Upload committed\./);
    expect(screen.queryByRole("button", { name: "Download error report" })).not.toBeInTheDocument();
  });

  it("surfaces a validation failure inline instead of showing a preview", async () => {
    mockedValidate.mockRejectedValue(new Error("Only .xlsx or .csv files are accepted"));
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
  });

  it("resets back to the file picker on 'Upload another file'", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    await openAndUpload();
    await screen.findByText("Created");
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText(/Upload committed\./);

    await userEvent.click(screen.getByRole("button", { name: "Upload another file" }));

    expect(screen.queryByText(/Upload committed\./)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
  });
});
