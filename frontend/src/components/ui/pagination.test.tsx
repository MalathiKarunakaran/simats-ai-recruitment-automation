import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "@/components/ui/pagination";

// First test file for this primitive -- covers both the pre-existing
// Previous/Next/"Showing X-Y of Z" behavior and the new optional
// `onLimitChange` page-size selector (Departments production-hardening
// epic, frontend Phase 2). Every pre-existing caller omits `onLimitChange`,
// so the "selector hidden" case below locks in that backward compatibility.

describe("Pagination", () => {
  it("shows the Showing X-Y of Z caption and disables Previous/Next at the boundaries", () => {
    const onOffsetChange = vi.fn();
    render(<Pagination total={2} limit={50} offset={0} onOffsetChange={onOffsetChange} itemLabel="things" />);

    expect(screen.getByText("Showing 1–2 of 2 things")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("calls onOffsetChange with the next/previous page's offset", async () => {
    const onOffsetChange = vi.fn();
    render(<Pagination total={120} limit={50} offset={50} onOffsetChange={onOffsetChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onOffsetChange).toHaveBeenCalledWith(100);

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onOffsetChange).toHaveBeenCalledWith(0);
  });

  it("does not render a page-size selector when onLimitChange is omitted", () => {
    render(<Pagination total={120} limit={50} offset={0} onOffsetChange={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "Rows per page" })).not.toBeInTheDocument();
  });

  it("renders a page-size selector defaulting to 10/25/50/100 when onLimitChange is provided", async () => {
    const onLimitChange = vi.fn();
    render(<Pagination total={120} limit={50} offset={50} onOffsetChange={vi.fn()} onLimitChange={onLimitChange} />);

    const selector = screen.getByRole("combobox", { name: "Rows per page" });
    expect(selector).toBeInTheDocument();

    await userEvent.click(selector);
    expect(await screen.findByRole("option", { name: "10" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "25" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "50" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "100" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: "100" }));
    expect(onLimitChange).toHaveBeenCalledWith(100);
  });

  it("still includes the current limit as an option even when it isn't one of limitOptions", async () => {
    render(
      <Pagination
        total={120}
        limit={20}
        offset={0}
        onOffsetChange={vi.fn()}
        onLimitChange={vi.fn()}
        limitOptions={[10, 25, 50]}
      />,
    );

    const selector = screen.getByRole("combobox", { name: "Rows per page" });
    await userEvent.click(selector);
    expect(await screen.findByRole("option", { name: "20" })).toBeInTheDocument();
  });
});
