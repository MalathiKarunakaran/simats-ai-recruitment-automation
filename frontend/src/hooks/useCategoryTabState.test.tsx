import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useCategoryTabState } from "@/hooks/useCategoryTabState";

// Exercises the hook against real react-router DOM/routing behavior (a
// MemoryRouter, real useSearchParams/useNavigate), not a mock -- this is
// the "demonstrate URL persistence via the Vitest router test harness"
// verification the Phase 3 plan calls for.
function Harness() {
  const [category, setCategory] = useCategoryTabState();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div>
      <p data-testid="value">{category}</p>
      <p data-testid="raw-search">{searchParams.toString()}</p>
      <button type="button" onClick={() => setCategory("TEACHING")}>
        Set Teaching
      </button>
      <button type="button" onClick={() => setCategory("NON_TEACHING")}>
        Set Non-Teaching
      </button>
      <button type="button" onClick={() => setCategory("HOUSEKEEPING")}>
        Set Housekeeping
      </button>
      <button type="button" onClick={() => setCategory("ALL")}>
        Set All
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Go forward
      </button>
    </div>
  );
}

function renderHarness(initialEntries: string[] = ["/page"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Harness />
    </MemoryRouter>,
  );
}

describe("useCategoryTabState", () => {
  it("defaults to ALL when the URL has no ?category param", () => {
    renderHarness(["/page"]);
    expect(screen.getByTestId("value")).toHaveTextContent("ALL");
  });

  it("reads TEACHING/NON_TEACHING/HOUSEKEEPING back from ?category=teaching|non-teaching|housekeeping", () => {
    const { unmount } = renderHarness(["/page?category=teaching"]);
    expect(screen.getByTestId("value")).toHaveTextContent("TEACHING");
    unmount();

    const { unmount: unmount2 } = renderHarness(["/page?category=non-teaching"]);
    expect(screen.getByTestId("value")).toHaveTextContent("NON_TEACHING");
    unmount2();

    renderHarness(["/page?category=housekeeping"]);
    expect(screen.getByTestId("value")).toHaveTextContent("HOUSEKEEPING");
  });

  it("falls back to ALL for an unrecognized ?category value", () => {
    renderHarness(["/page?category=bogus"]);
    expect(screen.getByTestId("value")).toHaveTextContent("ALL");
  });

  it("writes the lowercase-hyphenated URL param when the value changes, and omits it entirely for ALL", async () => {
    renderHarness(["/page"]);

    await userEvent.click(screen.getByRole("button", { name: "Set Non-Teaching" }));
    expect(screen.getByTestId("value")).toHaveTextContent("NON_TEACHING");
    expect(screen.getByTestId("raw-search")).toHaveTextContent("category=non-teaching");

    await userEvent.click(screen.getByRole("button", { name: "Set All" }));
    expect(screen.getByTestId("value")).toHaveTextContent("ALL");
    // ALL is the unselected state -- omitted from the URL entirely rather
    // than written as ?category=all, so the URL for the default state stays
    // as clean/shareable as it was before this hook ever ran.
    expect(screen.getByTestId("raw-search")).toHaveTextContent("");
  });

  it("survives back/forward navigation -- selecting a category then going back restores the prior selection", async () => {
    renderHarness(["/page"]);
    expect(screen.getByTestId("value")).toHaveTextContent("ALL");

    await userEvent.click(screen.getByRole("button", { name: "Set Teaching" }));
    expect(screen.getByTestId("value")).toHaveTextContent("TEACHING");

    await userEvent.click(screen.getByRole("button", { name: "Set Housekeeping" }));
    expect(screen.getByTestId("value")).toHaveTextContent("HOUSEKEEPING");

    // Back should restore TEACHING (the previous history entry), not reset
    // straight to ALL -- each category change pushes a new history entry
    // (setSearchParams's default { replace: false }).
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByTestId("value")).toHaveTextContent("TEACHING");

    // Back again restores the original (pre-selection) ALL state.
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByTestId("value")).toHaveTextContent("ALL");

    // Forward replays TEACHING then HOUSEKEEPING back in, one step at a time.
    await userEvent.click(screen.getByRole("button", { name: "Go forward" }));
    expect(await screen.findByTestId("value")).toHaveTextContent("TEACHING");
    await userEvent.click(screen.getByRole("button", { name: "Go forward" }));
    expect(await screen.findByTestId("value")).toHaveTextContent("HOUSEKEEPING");
  });

  it("simulates a refresh -- a fresh mount against the same URL reads the same category back", () => {
    const { unmount } = renderHarness(["/page?category=non-teaching"]);
    expect(screen.getByTestId("value")).toHaveTextContent("NON_TEACHING");
    unmount();

    // A "refresh" is a brand-new mount against the same URL (no component
    // state survives a real browser refresh) -- the value must come from
    // the URL alone, not any in-memory state carried over from the first
    // mount.
    renderHarness(["/page?category=non-teaching"]);
    expect(screen.getByTestId("value")).toHaveTextContent("NON_TEACHING");
  });

  it("preserves other existing query params when the category changes", async () => {
    renderHarness(["/page?status=ACTIVE"]);

    await userEvent.click(screen.getByRole("button", { name: "Set Teaching" }));

    expect(screen.getByTestId("value")).toHaveTextContent("TEACHING");
    // The status param set before this hook ever ran is untouched --
    // setSearchParams's functional-updater form (new URLSearchParams(prev))
    // merges with the existing params rather than replacing the whole query
    // string.
    const rawSearch = screen.getByTestId("raw-search").textContent ?? "";
    expect(rawSearch).toContain("status=ACTIVE");
    expect(rawSearch).toContain("category=teaching");
  });
});
