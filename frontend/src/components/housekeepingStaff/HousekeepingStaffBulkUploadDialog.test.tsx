import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as housekeepingStaffApi from "@/api/housekeepingStaff";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type {
  HousekeepingStaffBulkUploadCommitResponse,
  HousekeepingStaffBulkUploadValidationResponse,
} from "@/api/types";
import { HousekeepingStaffBulkUploadDialog } from "@/components/housekeepingStaff/HousekeepingStaffBulkUploadDialog";

// Sibling of components/locations/LocationBulkUploadDialog.test.tsx and
// components/sanctionedStrength/BulkUploadDialog.test.tsx -- same flow, own
// (wider) row shape/API module.

vi.mock("@/api/housekeepingStaff");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(housekeepingStaffApi.validateHousekeepingStaffBulkUpload);
const mockedCommit = vi.mocked(housekeepingStaffApi.commitHousekeepingStaffBulkUpload);
const mockedDownloadTemplate = vi.mocked(housekeepingStaffApi.downloadHousekeepingStaffBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: HousekeepingStaffBulkUploadValidationResponse = {
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
      bio_id: "BIO-100",
      name: "Kamala Devi",
      designation_name: "Housekeeping Supervisor",
      location_name: "Central Library",
      block: "Block A",
      floor_venue: "Ground Floor",
      shift: "MORNING",
      supervisor: "Ramesh",
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown campus code",
      campus_code: "ZZZ",
      bio_id: "BIO-101",
      name: "Suresh Kumar",
      designation_name: null,
      location_name: null,
      block: null,
      floor_venue: null,
      shift: null,
      supervisor: null,
    },
  ],
};

const COMMIT_RESULT: HousekeepingStaffBulkUploadCommitResponse = { ...VALIDATION_RESULT, bulk_upload_log_id: "bu-1" };

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HousekeepingStaffBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("HousekeepingStaffBulkUploadDialog", () => {
  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with HousekeepingStaff-shaped columns", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText("Kamala Devi")).toBeInTheDocument();
    expect(screen.getByText("BIO-100")).toBeInTheDocument();
    expect(screen.getByText("Housekeeping Supervisor")).toBeInTheDocument();
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
  });

  it("commits the same file re-sent to /commit and shows the committed result with an error-report download", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText("Kamala Devi");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText("Upload committed.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download error report" }));
    await waitFor(() => expect(mockedDownloadErrorReport).toHaveBeenCalledWith("bu-1"));
  });

  it("surfaces a validation failure inline instead of showing a preview", async () => {
    mockedValidate.mockRejectedValue(new Error("Only .xlsx or .csv files are accepted"));
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
  });
});
