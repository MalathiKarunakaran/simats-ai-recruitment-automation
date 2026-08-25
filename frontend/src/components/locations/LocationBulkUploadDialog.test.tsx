import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as locationsApi from "@/api/locations";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { LocationBulkUploadCommitResponse, LocationBulkUploadValidationResponse } from "@/api/types";
import { LocationBulkUploadDialog } from "@/components/locations/LocationBulkUploadDialog";

// Sibling of components/sanctionedStrength/BulkUploadDialog.test.tsx --
// same flow, own row shape/API module. downloadSanctionedStrengthBulkUploadErrorReport
// is mocked from api/sanctionedStrength.ts (not api/locations.ts) since
// LocationBulkUploadDialog reuses that shared function directly rather than
// duplicating it (see the component's own docstring).

vi.mock("@/api/locations");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(locationsApi.validateLocationBulkUpload);
const mockedCommit = vi.mocked(locationsApi.commitLocationBulkUpload);
const mockedDownloadTemplate = vi.mocked(locationsApi.downloadLocationBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: LocationBulkUploadValidationResponse = {
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
      location_name: "Central Library",
      block_building: "Block A",
      floor_venue: "Ground Floor",
      category: "TEACHING",
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown campus code",
      campus_code: "ZZZ",
      location_name: "Store Room",
      block_building: null,
      floor_venue: null,
      category: null,
    },
  ],
};

const COMMIT_RESULT: LocationBulkUploadCommitResponse = {
  ...VALIDATION_RESULT,
  bulk_upload_log_id: "bu-1",
  storage_warning: null,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocationBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("LocationBulkUploadDialog", () => {
  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with Location-shaped columns", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(screen.getByText("Block A")).toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
  });

  it("commits the same file re-sent to /commit and shows the committed result with an error-report download", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue(COMMIT_RESULT);
    renderDialog();

    const file = await openAndUpload();
    await screen.findByText("Central Library");

    await userEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(mockedCommit).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/Upload committed\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download error report" }));
    // The shared, entity-agnostic error-report endpoint -- reused verbatim,
    // not a Location-specific duplicate.
    await waitFor(() => expect(mockedDownloadErrorReport).toHaveBeenCalledWith("bu-1"));
  });

  it("commits successfully and shows a non-blocking warning when the workbook could not be archived", async () => {
    // The exact bug this fix closes: object storage being unreachable must
    // never surface as a hard failure ("Could not reach object storage")
    // when the rows themselves committed successfully.
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    mockedCommit.mockResolvedValue({
      ...COMMIT_RESULT,
      storage_warning:
        "Workbook storage is temporarily unavailable. The file was successfully parsed, " +
        "but the original workbook could not be archived.",
    });
    renderDialog();

    await openAndUpload();
    await screen.findByText("Central Library");
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
});
