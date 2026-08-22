import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui/toast";

// Minimal consumer -- exercises useToast() exactly the way a future page's
// mutation onSuccess/onError handler would, without needing a real form.
// The "short" variants pass an explicit short duration so the auto-dismiss
// test doesn't have to wait out the real 5s default.
function ToastTrigger() {
  const { success, error } = useToast();
  return (
    <>
      <button type="button" onClick={() => success("Saved.")}>
        trigger success
      </button>
      <button type="button" onClick={() => error("Could not save changes.")}>
        trigger error
      </button>
      <button type="button" onClick={() => success("Saved.", 30)}>
        trigger short success
      </button>
    </>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <ToastTrigger />
    </ToastProvider>,
  );
}

describe("useToast / ToastProvider", () => {
  it("throws when useToast is called outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    // React logs a console.error for the thrown-during-render case; the
    // assertion is on the throw itself, not the console noise.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow("useToast must be used within a ToastProvider");
    consoleSpy.mockRestore();
  });

  it("renders a success toast with its message and a status role", async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "trigger success" }));

    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("stacks multiple toasts, most recent last", async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "trigger success" }));
    await user.click(screen.getByRole("button", { name: "trigger error" }));

    const toasts = screen.getAllByRole("status");
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toHaveTextContent("Saved.");
    expect(toasts[1]).toHaveTextContent("Could not save changes.");
  });

  it("dismisses a toast manually via its dismiss button", async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "trigger success" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-dismisses a toast after its duration elapses", async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByRole("button", { name: "trigger short success" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Real timers (no vi.useFakeTimers()) -- userEvent's own internals rely
    // on real timers, so the short 30ms duration passed by the trigger above
    // is what keeps this fast rather than faking the clock.
    await waitForElementToBeRemoved(() => screen.queryByRole("status"));
  });
});
