import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import * as sanctionedStrengthApi from "@/api/sanctionedStrength";
import type { BulkUploadLogRead } from "@/api/types";
import { UploadHistoryTab } from "@/components/sanctionedStrength/UploadHistoryTab";

vi.mock("@/api/sanctionedStrength");

const mockedList = vi.mocked(sanctionedStrengthApi.listSanctionedStrengthBulkUploads);
const mockedDownloadOriginal = vi.mocked(sanctionedStrengthApi.downloadSanctionedStrengthBulkUploadOriginalFile);
const mockedUndo = vi.mocked(sanctionedStrengthApi.undoSanctionedStrengthBulkUpload);

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

const WITHIN_WINDOW: BulkUploadLogRead = {
  id: "bu-1",
  filename: "batch-1.xlsx",
  uploaded_by_id: "11111111-2222-3333-4444-555555555555",
  uploaded_at: "2026-08-10T10:00:00Z",
  rows_total: 10,
  rows_created: 4,
  rows_updated: 5,
  rows_rejected: 1,
  stored_file_object_key: "bulk-uploads/bu-1/batch-1.xlsx",
  status: "COMPLETED",
  undo_deadline: FUTURE,
  undone_at: null,
  undone_by_id: null,
};

const PAST_WINDOW: BulkUploadLogRead = {
  ...WITHIN_WINDOW,
  id: "bu-2",
  filename: "batch-2.xlsx",
  undo_deadline: PAST,
};

const ALREADY_UNDONE: BulkUploadLogRead = {
  ...WITHIN_WINDOW,
  id: "bu-3",
  filename: "batch-3.xlsx",
  status: "UNDONE",
};

function paginated(items: BulkUploadLogRead[], total = items.length) {
  return { items, total, limit: 20, offset: 0 };
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UploadHistoryTab />
    </QueryClientProvider>,
  );
}

describe("UploadHistoryTab", () => {
  it("renders filename/uploader/timestamp/row counts/status for each upload", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW]));

    renderTab();

    expect(await screen.findByText("batch-1.xlsx")).toBeInTheDocument();
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(screen.getByText(/10 total \(4 created, 5 updated, 1 rejected\)/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("offers Undo only for a batch still within its 24h window", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW, PAST_WINDOW, ALREADY_UNDONE]));

    renderTab();
    await screen.findByText("batch-1.xlsx");

    expect(screen.getByRole("button", { name: "Undo upload batch-1.xlsx" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo upload batch-2.xlsx" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo upload batch-3.xlsx" })).not.toBeInTheDocument();
    expect(screen.getByText("Undone")).toBeInTheDocument();
  });

  it("downloads the original file for a row", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW]));

    renderTab();
    await screen.findByText("batch-1.xlsx");

    await userEvent.click(screen.getByRole("button", { name: "Download original file" }));

    await waitFor(() => expect(mockedDownloadOriginal).toHaveBeenCalledWith("bu-1", "batch-1.xlsx"));
  });

  it("confirms and calls undo via the confirm dialog", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW]));
    mockedUndo.mockResolvedValue({ id: "bu-1", status: "UNDONE", reverted_history_count: 3 });

    renderTab();
    await screen.findByText("batch-1.xlsx");

    await userEvent.click(screen.getByRole("button", { name: "Undo upload batch-1.xlsx" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm undo" }));

    await waitFor(() => expect(mockedUndo).toHaveBeenCalledWith("bu-1"));
  });

  it("surfaces the backend's expired-window 409 message inline in the confirm dialog, not a generic failure", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW]));
    mockedUndo.mockRejectedValue(new ApiError(409, "The 24-hour undo window for this upload has expired"));

    renderTab();
    await screen.findByText("batch-1.xlsx");

    await userEvent.click(screen.getByRole("button", { name: "Undo upload batch-1.xlsx" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm undo" }));

    expect(
      await within(dialog).findByText("The 24-hour undo window for this upload has expired"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no uploads yet", async () => {
    mockedList.mockResolvedValue(paginated([]));

    renderTab();

    expect(await screen.findByText("No bulk uploads yet.")).toBeInTheDocument();
  });

  it("paginates with Previous/Next", async () => {
    mockedList.mockResolvedValue(paginated([WITHIN_WINDOW], 50));

    renderTab();
    await screen.findByText("batch-1.xlsx");

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    await userEvent.click(nextButton);

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 })),
    );
  });
});
