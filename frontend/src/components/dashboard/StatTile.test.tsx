import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatTile } from "@/components/dashboard/StatTile";

describe("StatTile", () => {
  it("shows the loaded value when present", () => {
    render(<StatTile label="Open positions" value={12} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the zero caption when the loaded value is exactly zero", () => {
    render(<StatTile label="Rejected" value={0} zeroCaption="No activity in this scope yet" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No activity in this scope yet")).toBeInTheDocument();
  });

  it("shows a loading skeleton, not the empty state, while isLoading is true", () => {
    render(<StatTile label="Vacancy closure rate (%)" value={undefined} isLoading />);
    expect(screen.getByRole("status", { name: "Loading Vacancy closure rate (%)" })).toBeInTheDocument();
    expect(screen.queryByText("Not enough data yet")).not.toBeInTheDocument();
  });

  it("shows 'Not enough data yet' for a loaded null value, not a bare em-dash or literal 0%", () => {
    render(<StatTile label="Vacancy closure rate (%)" value={null} />);
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
