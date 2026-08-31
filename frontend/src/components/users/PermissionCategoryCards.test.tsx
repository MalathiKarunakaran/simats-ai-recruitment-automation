import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS, type Permission } from "@/api/types";
import { PermissionCategoryCards } from "@/components/users/PermissionCategoryCards";

// Rewritten 2026-08-31 alongside the component. The old suite drove a
// per-category "Manage Permissions" drawer; the matrix is now inline and
// saves as one whole set, so the flows under test are genuinely different --
// what survives unchanged is the coverage of the things that must NOT drift:
// the category set and labels, the summary strip, the Sensitive/Destructive
// badges, and the fact that exactly one call reaches PUT /users/{id}/permissions.

function renderCards(overrides: Partial<Parameters<typeof PermissionCategoryCards>[0]> = {}) {
  const onPermissionsChange = vi.fn();
  const onSave = vi.fn();
  const props = {
    permissions: [] as Permission[],
    onPermissionsChange,
    onSave,
    isSaving: false,
    saveError: null,
    ...overrides,
  };
  const utils = render(<PermissionCategoryCards {...props} />);
  return { ...utils, onPermissionsChange, onSave };
}

function categoriesRegion() {
  return screen.getByRole("region", { name: "Permission categories" });
}

// The summary strip's "Enabled: N" etc. text is split across a parent <span>
// and a nested styled <span> for the number (see PermissionCategoryCards'
// own JSX) -- RTL's default string matcher only matches a single node's own
// textContent, so an exact string match against the parent misses. A custom
// matcher function receives each node's own full textContent, which does
// include its nested child's text, so this matches the outer <span> only.
function exactText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

/** The section wrapper for a category, so Select All / Clear All can be scoped. */
function section(label: string): HTMLElement {
  const heading = within(categoriesRegion()).getByText(label);
  const wrapper = heading.closest(".rounded-2xl");
  if (!wrapper) throw new Error(`No section wrapper found for "${label}"`);
  return wrapper as HTMLElement;
}

function toggle(name: string) {
  return screen.getByRole("switch", { name });
}

describe("PermissionCategoryCards", () => {
  it("renders one expandable section per category, using the cosmetic 'Candidates & Applications' label for CANDIDATES only", () => {
    renderCards();

    const region = categoriesRegion();
    expect(within(region).getByText("Vacancy Management")).toBeInTheDocument();
    expect(within(region).getByText("Candidates & Applications")).toBeInTheDocument();
    expect(within(region).getByText("Interviews")).toBeInTheDocument();
    expect(within(region).getByText("Recruitment")).toBeInTheDocument();
    expect(within(region).getByText("Administration")).toBeInTheDocument();
    expect(within(region).getByText("System")).toBeInTheDocument();
  });

  it("shows every permission as a visible toggle without opening anything -- the point of the rework", () => {
    renderCards();

    // No drawer, no per-category button standing between the admin and the
    // controls: one switch per permission the backend defines, on screen.
    expect(screen.getAllByRole("switch")).toHaveLength(PERMISSIONS.length);
    expect(screen.queryByRole("button", { name: "Manage Permissions" })).not.toBeInTheDocument();
  });

  it("checks exactly the permissions the backend already granted", () => {
    renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    expect(toggle("View vacancies")).toBeChecked();
    expect(toggle("Manage users")).toBeChecked();
    expect(toggle("Create vacancy requests")).not.toBeChecked();
    expect(toggle("Delete candidates")).not.toBeChecked();
    expect(screen.getAllByRole("switch", { checked: true })).toHaveLength(2);
  });

  it("shows the top summary strip, live from the permissions prop", () => {
    renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    // MANAGE_USERS is in the Sensitive set; VIEW_VACANCY is not.
    expect(screen.getByText(exactText("Enabled: 2"))).toBeInTheDocument();
    expect(screen.getByText(exactText(`Restricted: ${PERMISSIONS.length - 2}`))).toBeInTheDocument();
    expect(screen.getByText(exactText("Sensitive: 1"))).toBeInTheDocument();
  });

  it("moves the summary as permissions are toggled, before anything is saved", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"] });

    await userEvent.click(toggle("Approve vacancies")); // Sensitive

    expect(screen.getByText(exactText("Enabled: 2"))).toBeInTheDocument();
    expect(screen.getByText(exactText(`Restricted: ${PERMISSIONS.length - 2}`))).toBeInTheDocument();
    expect(screen.getByText(exactText("Sensitive: 1"))).toBeInTheDocument();
  });

  it("shows an n/total count per section that tracks the draft", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"] });

    expect(within(section("Vacancy Management")).getByText("1/8")).toBeInTheDocument();

    await userEvent.click(toggle("Close vacancies"));
    expect(within(section("Vacancy Management")).getByText("2/8")).toBeInTheDocument();
  });

  it("Select All fills a group and Clear All empties it, without touching other groups", async () => {
    renderCards({ permissions: ["VIEW_CANDIDATES"] });

    await userEvent.click(within(section("Vacancy Management")).getByRole("button", { name: "Select All" }));
    expect(within(section("Vacancy Management")).getByText("8/8")).toBeInTheDocument();
    // The Candidates group is untouched by Vacancy Management's Select All.
    expect(toggle("View candidates")).toBeChecked();
    expect(within(section("Candidates & Applications")).getByText("1/5")).toBeInTheDocument();

    await userEvent.click(within(section("Vacancy Management")).getByRole("button", { name: "Clear All" }));
    expect(within(section("Vacancy Management")).getByText("0/8")).toBeInTheDocument();
    expect(toggle("View candidates")).toBeChecked();
  });

  it("Select All covers rows the search has filtered out, so it grants what it says", async () => {
    renderCards();

    await userEvent.type(screen.getByLabelText("Search permissions"), "approve");
    expect(screen.queryByRole("switch", { name: "Close vacancies" })).not.toBeInTheDocument();

    await userEvent.click(within(section("Vacancy Management")).getByRole("button", { name: "Select All" }));
    expect(within(section("Vacancy Management")).getByText("8/8")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search permissions"));
    expect(toggle("Close vacancies")).toBeChecked();
  });

  it("flags unsaved changes, and only enables Save once something actually changed", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"] });

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Permissions" })).toBeDisabled();

    await userEvent.click(toggle("Create vacancy requests"));

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Permissions" })).toBeEnabled();
  });

  it("Discard changes returns the draft to what the backend holds", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"] });

    await userEvent.click(toggle("Create vacancy requests"));
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(toggle("Create vacancy requests")).not.toBeChecked();
    expect(toggle("View vacancies")).toBeChecked();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("saves the WHOLE matrix in one call -- granting keeps the permissions already held", async () => {
    const { onSave } = renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    await userEvent.click(toggle("Schedule interviews"));
    await userEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [sent] = onSave.mock.calls[0];
    expect([...sent].sort()).toEqual(["MANAGE_USERS", "SCHEDULE_INTERVIEW", "VIEW_VACANCY"]);
  });

  it("saves a revoke as an absence -- the full-replace contract of PUT /users/{id}/permissions", async () => {
    const { onSave } = renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    await userEvent.click(toggle("Manage users"));
    await userEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

    const [sent] = onSave.mock.calls[0];
    expect(sent).toEqual(["VIEW_VACANCY"]);
  });

  it("confirms the save and clears the dirty flag once the parent reports success", async () => {
    const onSave = vi.fn((_permissions: Permission[], options: { onSuccess: () => void }) => options.onSuccess());
    const { onPermissionsChange } = renderCards({ permissions: ["VIEW_VACANCY"], onSave });

    await userEvent.click(toggle("Create vacancy requests"));
    await userEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

    expect(onPermissionsChange).toHaveBeenCalledWith(["VIEW_VACANCY", "CREATE_VACANCY_REQUEST"]);
    expect(screen.getByText("Permissions saved.")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("re-seeds from the backend when the saved set changes underneath it", () => {
    const { rerender } = renderCards({ permissions: ["VIEW_VACANCY"] });
    expect(toggle("Manage users")).not.toBeChecked();

    rerender(
      <PermissionCategoryCards
        permissions={["VIEW_VACANCY", "MANAGE_USERS"]}
        onPermissionsChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
        saveError={null}
      />,
    );

    expect(toggle("Manage users")).toBeChecked();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("does not clobber an in-progress edit when an identical refetch arrives in a different order", async () => {
    const { rerender } = renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    await userEvent.click(toggle("Schedule interviews"));

    rerender(
      <PermissionCategoryCards
        permissions={["MANAGE_USERS", "VIEW_VACANCY"]}
        onPermissionsChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
        saveError={null}
      />,
    );

    expect(toggle("Schedule interviews")).toBeChecked();
  });

  it("shows a 'Sensitive' badge on sensitive permissions and a 'Destructive' badge on DELETE_CANDIDATE, never color alone", () => {
    renderCards();

    const candidates = section("Candidates & Applications");
    expect(within(candidates).getByText("Destructive")).toBeInTheDocument();

    const administration = section("Administration");
    // MANAGE_USERS and MANAGE_CAMPUSES are both in the Sensitive set.
    expect(within(administration).getAllByText("Sensitive")).toHaveLength(2);
  });

  it("narrows visible rows by search without losing a toggle made before searching", async () => {
    renderCards();

    await userEvent.click(toggle("Close vacancies"));
    await userEvent.type(screen.getByLabelText("Search permissions"), "approve");

    expect(screen.getByRole("switch", { name: "Approve vacancies" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Close vacancies" })).not.toBeInTheDocument();
    // Still counted, still in the draft.
    expect(within(section("Vacancy Management")).getByText("1/8")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search permissions"));
    expect(toggle("Close vacancies")).toBeChecked();
  });

  it("collapses and re-expands a section without discarding its draft", async () => {
    renderCards();

    await userEvent.click(toggle("Approve vacancies"));
    const header = within(section("Vacancy Management")).getByRole("button", { expanded: true });
    await userEvent.click(header);

    expect(within(section("Vacancy Management")).getByRole("button", { expanded: false })).toBeInTheDocument();
    expect(within(section("Vacancy Management")).getByText("1/8")).toBeInTheDocument();
  });

  it("surfaces a save error and keeps the draft intact so it can be retried", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"], saveError: "Update failed" });

    await userEvent.click(toggle("Create vacancy requests"));

    expect(screen.getByText("Update failed")).toBeInTheDocument();
    expect(toggle("Create vacancy requests")).toBeChecked();
  });

  it("disables Save while a save is in flight", () => {
    renderCards({ permissions: ["VIEW_VACANCY"], isSaving: true });

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
