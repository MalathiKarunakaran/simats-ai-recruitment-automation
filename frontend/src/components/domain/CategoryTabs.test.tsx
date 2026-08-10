import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CategoryTabs, mapServerCategoryCounts } from "@/components/domain/CategoryTabs";

describe("CategoryTabs", () => {
  it("renders All | Teaching | Non-Teaching | Housekeeping in that fixed order, each with a live count", () => {
    render(
      <CategoryTabs
        value="ALL"
        onValueChange={vi.fn()}
        counts={{ all: 40, teaching: 18, nonTeaching: 15, housekeeping: 7 }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All (40)",
      "Teaching (18)",
      "Non-Teaching (15)",
      "Housekeeping (7)",
    ]);
  });

  it("omits the All tab when counts.all is undefined", () => {
    render(
      <CategoryTabs
        value="TEACHING"
        onValueChange={vi.fn()}
        counts={{ teaching: 18, nonTeaching: 15, housekeeping: 7 }}
      />,
    );

    expect(screen.queryByRole("tab", { name: /^All/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("marks the active tab via aria-selected and calls onValueChange with the clicked tab's value", async () => {
    const onValueChange = vi.fn();
    render(
      <CategoryTabs
        value="TEACHING"
        onValueChange={onValueChange}
        counts={{ all: 40, teaching: 18, nonTeaching: 15, housekeeping: 7 }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Teaching (18)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "All (40)" })).toHaveAttribute("aria-selected", "false");

    await userEvent.click(screen.getByRole("tab", { name: /^Non-Teaching/ }));
    expect(onValueChange).toHaveBeenCalledWith("NON_TEACHING");
  });
});

describe("mapServerCategoryCounts", () => {
  it("maps the backend's UPPER_SNAKE_CASE category_counts keys to CategoryTabs's counts prop shape", () => {
    expect(mapServerCategoryCounts({ TEACHING: 12, NON_TEACHING: 3, HOUSEKEEPING: 1, ALL: 16 })).toEqual({
      all: 16,
      teaching: 12,
      nonTeaching: 3,
      housekeeping: 1,
    });
  });

  it("defaults every count to 0 when the response hasn't arrived yet (undefined)", () => {
    expect(mapServerCategoryCounts(undefined)).toEqual({ all: 0, teaching: 0, nonTeaching: 0, housekeeping: 0 });
  });
});
