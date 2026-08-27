import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import * as eligibilityRulesApi from "@/api/eligibilityRules";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { EligibilityRuleBulkUploadCommitResponse, EligibilityRuleBulkUploadValidationResponse } from "@/api/types";
import { EligibilityRuleBulkUploadDialog } from "@/components/eligibilityRules/EligibilityRuleBulkUploadDialog";

// Sibling of components/departments/DepartmentBulkUploadDialog.test.tsx --
// same flow, own (much wider) row shape/API module.
// downloadSanctionedStrengthBulkUploadErrorReport is mocked from
// api/sanctionedStrength.ts (not api/eligibilityRules.ts) since
// EligibilityRuleBulkUploadDialog reuses that shared function directly
// rather than duplicating it (see the component's own docstring).

vi.mock("@/api/eligibilityRules");
vi.mock("@/api/sanctionedStrength");

const mockedValidate = vi.mocked(eligibilityRulesApi.validateEligibilityRuleBulkUpload);
const mockedCommit = vi.mocked(eligibilityRulesApi.commitEligibilityRuleBulkUpload);
const mockedDownloadTemplate = vi.mocked(eligibilityRulesApi.downloadEligibilityRuleBulkUploadTemplate);
const mockedDownloadErrorReport = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadErrorReport);

const VALIDATION_RESULT: EligibilityRuleBulkUploadValidationResponse = {
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
      staff_category: "TEACHING",
      position_title: "Assistant Professor",
      required_qualification_keyword: "PHD",
      net_set_required: true,
      subject: "Physics",
      skills_keyword: null,
      id_proof_required: null,
      shift_preference: null,
      regulatory_authority: "AICTE_UGC",
      school_or_college: "School of Engineering",
      programme_discipline: "B.E. Physics",
      minimum_qualification: "PhD in Physics",
      minimum_percentage: "60%",
      required_experience: "2 years",
      required_credential: null,
      required_keywords: "physics, mechanics",
      preferred_keywords: "research",
      phd_required: true,
      professional_registration: null,
      industry_experience: null,
      priority: "HIGH",
      effective_from: "2026-01-01",
      effective_to: null,
      source_regulation: "AICTE norms 2024",
      rule_status: "DRAFT",
      verification_required: true,
      is_active: false,
      notes: null,
    },
    {
      row_number: 3,
      status: "rejected",
      error_reason: "Unknown campus code",
      campus_code: "ZZZ",
      department_code: "CHEM",
      staff_category: "TEACHING",
      position_title: "Lecturer",
      required_qualification_keyword: "MASTERS",
      net_set_required: null,
      subject: null,
      skills_keyword: null,
      id_proof_required: null,
      shift_preference: null,
      regulatory_authority: null,
      school_or_college: null,
      programme_discipline: null,
      minimum_qualification: null,
      minimum_percentage: null,
      required_experience: null,
      required_credential: null,
      required_keywords: null,
      preferred_keywords: null,
      phd_required: null,
      professional_registration: null,
      industry_experience: null,
      priority: null,
      effective_from: null,
      effective_to: null,
      source_regulation: null,
      rule_status: null,
      verification_required: null,
      is_active: null,
      notes: null,
    },
  ],
};

const COMMIT_RESULT: EligibilityRuleBulkUploadCommitResponse = {
  ...VALIDATION_RESULT,
  bulk_upload_log_id: "bu-1",
  storage_warning: null,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EligibilityRuleBulkUploadDialog />
    </QueryClientProvider>,
  );
}

async function openAndUpload(file = new File(["dummy"], "upload.xlsx")) {
  await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, file);
  return file;
}

describe("EligibilityRuleBulkUploadDialog", () => {
  it("renders a rejected row's reason without needing horizontal scrolling", async () => {
    // Regression guard (2026-08-27): the reason used to be a trailing
    // "Details" column sitting off the right edge behind a horizontal
    // scrollbar -- the most important cell when something goes wrong was the
    // one the user could not see. It is now a full-width row directly under
    // the row it explains.
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();
    await openAndUpload();

    const reason = await screen.findByText("Unknown campus code");
    expect(reason.tagName).toBe("TD");
    expect(reason).toHaveAttribute("colspan", "9");
    expect(screen.queryByRole("columnheader", { name: "Details" })).not.toBeInTheDocument();
  });

  it("opens the dialog and downloads the template on request", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Bulk upload" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(mockedDownloadTemplate).toHaveBeenCalled());
  });

  it("validates the chosen file and renders the preview with EligibilityRule-shaped columns", async () => {
    mockedValidate.mockResolvedValue(VALIDATION_RESULT);
    renderDialog();

    const file = await openAndUpload();

    await waitFor(() => expect(mockedValidate).toHaveBeenCalledWith(file));
    expect(
      await screen.findByText("2 rows: 1 created, 0 updated, 0 unchanged, 1 rejected."),
    ).toBeInTheDocument();
    expect(screen.getByText("Assistant Professor")).toBeInTheDocument();
    expect(screen.getByText("PHD")).toBeInTheDocument();
    expect(screen.getByText("Unknown campus code")).toBeInTheDocument();
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
    // not an EligibilityRule-specific duplicate.
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

  it("disables Commit until a file has been validated with at least one row", async () => {
    mockedValidate.mockResolvedValue({ ...VALIDATION_RESULT, total: 0, created_count: 0, rejected_count: 0, rows: [] });
    renderDialog();

    await openAndUpload();

    expect(await screen.findByText("No rows in this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});
