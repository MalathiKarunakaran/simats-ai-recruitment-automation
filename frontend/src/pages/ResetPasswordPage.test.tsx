import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";

vi.mock("@/api/auth", () => ({ confirmPasswordReset: vi.fn() }));
const mockedConfirm = vi.mocked(authApi.confirmPasswordReset);

const TOKEN = "a".repeat(64);

function LoginStub() {
  const state = useLocation().state as { passwordReset?: boolean } | null;
  return <div>login page{state?.passwordReset ? " (reset done)" : ""}</div>;
}

// The token arrives in the fragment of the real address bar, which
// MemoryRouter does not own, so the test sets window.location.hash itself.
function renderWithHash(hash: string) {
  window.history.replaceState(null, "", `/reset-password${hash}`);
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  mockedConfirm.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("ResetPasswordPage", () => {
  it("sets the new password with the token from the link, then returns to sign-in", async () => {
    mockedConfirm.mockResolvedValue(undefined);
    renderWithHash(`#token=${TOKEN}`);

    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(mockedConfirm).toHaveBeenCalledWith(TOKEN, "a-long-new-password");
    expect(await screen.findByText("login page (reset done)")).toBeInTheDocument();
  });

  it("takes the token out of the address bar", () => {
    renderWithHash(`#token=${TOKEN}`);

    expect(window.location.hash).toBe("");
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("refuses a short or mismatched password without calling the server", async () => {
    renderWithHash(`#token=${TOKEN}`);

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 12 characters");

    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("do not match");

    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("explains an expired or used link", async () => {
    mockedConfirm.mockRejectedValue(new ApiError(400, "Invalid or expired reset token"));
    renderWithHash(`#token=${TOKEN}`);

    await userEvent.type(screen.getByLabelText("New password"), "a-long-new-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "a-long-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid, already used or expired");
  });

  it("says what to do when opened without a link", () => {
    renderWithHash("");

    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("needs the link from your reset email");
  });
});
