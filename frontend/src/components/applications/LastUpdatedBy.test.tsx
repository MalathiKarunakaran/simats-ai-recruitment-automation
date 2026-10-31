import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { relativeTime } from "@/lib/relativeTime";

import { LastUpdatedBy } from "./LastUpdatedBy";

describe("LastUpdatedBy", () => {
  it("shows the name and relative time, with the absolute IST time in the tooltip", () => {
    const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(<LastUpdatedBy withLabel name="Asha Rao" at={at} />);

    const text = screen.getByText("Last updated by Asha Rao · 2 hr ago");
    expect(text).toHaveAttribute("title", expect.stringMatching(/IST$/));
  });

  it("shows System when the audit row has no actor", () => {
    render(<LastUpdatedBy name={null} at={new Date().toISOString()} />);
    expect(screen.getByText("System · just now")).toBeInTheDocument();
  });

  it("shows a dash in a column, and nothing in a header, when there is no audit row", () => {
    const { container, unmount } = render(<LastUpdatedBy withLabel name={null} at={null} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<LastUpdatedBy name={null} at={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("formats the tooltip in Asia/Kolkata", () => {
    render(<LastUpdatedBy name="Asha Rao" at="2026-02-10T04:30:00Z" />);
    // 04:30 UTC is 10:00 in India.
    expect(screen.getByText(/^Asha Rao · /)).toHaveAttribute("title", expect.stringContaining("10:00"));
  });

  it("buckets relative time", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(relativeTime(new Date(now - 30 * 1000), now)).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60 * 1000), now)).toBe("5 min ago");
    expect(relativeTime(new Date(now - 24 * 60 * 60 * 1000), now)).toBe("1 day ago");
    expect(relativeTime(new Date(now - 3 * 24 * 60 * 60 * 1000), now)).toBe("3 days ago");
  });
});
