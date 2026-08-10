import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineNumberCell } from "@/components/sanctionedStrength/InlineNumberCell";

describe("InlineNumberCell", () => {
  it("renders the plain value with no edit affordance when readOnly", () => {
    render(<InlineNumberCell value={5} onSave={vi.fn()} readOnly />);

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("enters edit mode on click, showing an input pre-filled with the current value", async () => {
    render(<InlineNumberCell value={5} onSave={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(5);
  });

  it("commits on Enter, calling onSave with the typed number and exiting edit mode on success", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<InlineNumberCell value={5} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "12");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(12));
    // Back to display mode -- input is gone.
    await waitFor(() => expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument());
  });

  it("commits via the tick button too, not just Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<InlineNumberCell value={5} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(9));
  });

  it("cancels on Escape, reverting to display mode without calling onSave", async () => {
    const onSave = vi.fn();
    render(<InlineNumberCell value={5} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "99");
    await userEvent.keyboard("{Escape}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    // Reverted, not left showing the abandoned "99" draft.
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("cancels via the X button too", async () => {
    const onSave = vi.fn();
    render(<InlineNumberCell value={5} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("disables the tick button and shows a validation message for a negative value, without calling onSave", async () => {
    const onSave = vi.fn();
    render(<InlineNumberCell value={5} onSave={onSave} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "-3");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();

    // Enter also does nothing while invalid -- no silent-reject-on-submit.
    await userEvent.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables the tick button for a non-integer value", async () => {
    render(<InlineNumberCell value={5} onSave={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "3.5");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("stays in edit mode and shows saveError when onSave resolves false", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    render(<InlineNumberCell value={5} onSave={onSave} saveError="Something went wrong" />);

    await userEvent.click(screen.getByRole("button", { name: /Edit approved value/ }));
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "7");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7));
    // Still in edit mode -- the input is still there.
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
