import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import { DeleteConfirmDialog } from "@/components/domain/DeleteConfirmDialog";

function renderDialog(onDelete: () => Promise<unknown>, onDeleted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onDeleted,
    ...render(
      <QueryClientProvider client={client}>
        <DeleteConfirmDialog
          triggerAriaLabel="Delete thing X"
          title="Delete thing"
          description="Remove thing X?"
          onDelete={onDelete}
          onDeleted={onDeleted}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("DeleteConfirmDialog", () => {
  it("opens on trigger click and shows the title/description", async () => {
    renderDialog(vi.fn().mockResolvedValue(undefined));

    await userEvent.click(screen.getByRole("button", { name: "Delete thing X" }));

    expect(screen.getByText("Delete thing")).toBeInTheDocument();
    expect(screen.getByText("Remove thing X?")).toBeInTheDocument();
  });

  it("calls onDelete and onDeleted, then closes, on Confirm delete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { onDeleted } = renderDialog(onDelete);

    await userEvent.click(screen.getByRole("button", { name: "Delete thing X" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Delete thing")).not.toBeInTheDocument());
  });

  it("surfaces the backend's exact 409 detail message inline, not a generic conflict message", async () => {
    const onDelete = vi.fn().mockRejectedValue(new ApiError(409, "3 active department(s) reference this campus, cannot delete."));
    renderDialog(onDelete);

    await userEvent.click(screen.getByRole("button", { name: "Delete thing X" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(within(dialog).getByText("3 active department(s) reference this campus, cannot delete.")).toBeInTheDocument(),
    );
    // Dialog stays open on failure -- the user can read the message.
    expect(screen.getByText("Delete thing")).toBeInTheDocument();
  });
});
