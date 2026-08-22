import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS, type Permission } from "@/api/types";
import { PermissionCategoryCards } from "@/components/users/PermissionCategoryCards";

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

describe("PermissionCategoryCards", () => {
  it("renders one compact card per category, using the cosmetic 'Candidates & Applications' label for CANDIDATES only", () => {
    renderCards();

    const region = categoriesRegion();
    expect(within(region).getByText("Vacancy Management")).toBeInTheDocument();
    expect(within(region).getByText("Candidates & Applications")).toBeInTheDocument();
    expect(within(region).getByText("Interviews")).toBeInTheDocument();
    expect(within(region).getByText("Recruitment")).toBeInTheDocument();
    expect(within(region).getByText("Administration")).toBeInTheDocument();
    expect(within(region).getByText("System")).toBeInTheDocument();
    expect(within(region).getAllByRole("button", { name: "Manage Permissions" })).toHaveLength(6);
  });

  it("shows the top summary strip, live from the permissions prop", () => {
    renderCards({ permissions: ["VIEW_VACANCY", "MANAGE_USERS"] });

    // MANAGE_USERS is in the Sensitive set; VIEW_VACANCY is not.
    expect(screen.getByText(exactText("Enabled: 2"))).toBeInTheDocument();
    expect(screen.getByText(exactText(`Restricted: ${PERMISSIONS.length - 2}`))).toBeInTheDocument();
    expect(screen.getByText(exactText("Sensitive: 1"))).toBeInTheDocument();
  });

  it("shows a 0/N count and no pills on an empty category", () => {
    renderCards();

    const region = categoriesRegion();
    const vacancyCard = within(region).getByText("Vacancy Management").closest(".rounded-xl") as HTMLElement;
    expect(within(vacancyCard).getByText("0/8")).toBeInTheDocument();
    expect(within(vacancyCard).getByText("No permissions granted yet.")).toBeInTheDocument();
  });

  it("shows enabled-permission pills capped at 4 with a '+N more' overflow indicator", () => {
    renderCards({
      permissions: [
        "VIEW_EMPLOYEES",
        "EDIT_EMPLOYEES",
        "MANAGE_DEPARTMENTS",
        "MANAGE_DESIGNATIONS",
        "MANAGE_LOCATIONS",
        "MANAGE_CAMPUSES",
        "MANAGE_USERS",
      ],
    });

    const region = categoriesRegion();
    const adminCard = within(region).getByText("Administration").closest(".rounded-xl") as HTMLElement;
    expect(within(adminCard).getByText("7/7")).toBeInTheDocument();
    expect(within(adminCard).getByText("View employees")).toBeInTheDocument();
    expect(within(adminCard).getByText("Edit employees")).toBeInTheDocument();
    expect(within(adminCard).getByText("Manage departments")).toBeInTheDocument();
    expect(within(adminCard).getByText("Manage designations")).toBeInTheDocument();
    expect(within(adminCard).getByText("+3 more")).toBeInTheDocument();
    expect(within(adminCard).queryByText("Manage users")).not.toBeInTheDocument();
  });

  it("opens a drawer scoped to the clicked category, with a live enabled/total header count", async () => {
    renderCards({ permissions: ["VIEW_VACANCY"] });

    const region = categoriesRegion();
    const vacancyCard = within(region).getByText("Vacancy Management").closest(".rounded-xl") as HTMLElement;
    await userEvent.click(within(vacancyCard).getByRole("button", { name: "Manage Permissions" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("1/8 enabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "View vacancies" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Create vacancy requests" })).not.toBeChecked();
    // Interviews-category permissions must not leak into this drawer.
    expect(screen.queryByRole("switch", { name: "Schedule interviews" })).not.toBeInTheDocument();
  });

  it("shows a 'Sensitive' badge on sensitive permissions and a 'Destructive' badge on DELETE_CANDIDATE, never color alone", async () => {
    renderCards();

    const region = categoriesRegion();
    await userEvent.click(
      within(within(region).getByText("Candidates & Applications").closest(".rounded-xl") as HTMLElement).getByRole(
        "button",
        { name: "Manage Permissions" },
      ),
    );

    const deleteRow = screen.getByRole("switch", { name: "Delete candidates" }).closest("div")!.parentElement!;
    expect(within(deleteRow).getByText("Destructive")).toBeInTheDocument();
    const viewRow = screen.getByRole("switch", { name: "View candidates" }).closest("div")!.parentElement!;
    expect(within(viewRow).queryByText("Destructive")).not.toBeInTheDocument();
    expect(within(viewRow).queryByText("Sensitive")).not.toBeInTheDocument();
  });

  it("filters visible rows by the search box without losing the toggle state of a hidden row", async () => {
    renderCards({ permissions: [] });
    const region = categoriesRegion();
    await userEvent.click(
      within(within(region).getByText("Administration").closest(".rounded-xl") as HTMLElement).getByRole("button", {
        name: "Manage Permissions",
      }),
    );

    // Toggle a row on, then search for something that hides it.
    await userEvent.click(screen.getByRole("switch", { name: "View employees" }));
    await userEvent.type(screen.getByLabelText("Search permissions"), "manage");

    expect(screen.queryByRole("switch", { name: "View employees" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Manage users" })).toBeInTheDocument();

    // Clearing the search reveals the row again, still toggled on.
    await userEvent.clear(screen.getByLabelText("Search permissions"));
    expect(screen.getByRole("switch", { name: "View employees" })).toBeChecked();
  });

  it("Enable All / Disable All toggle every permission in the category", async () => {
    renderCards({ permissions: [] });
    const region = categoriesRegion();
    await userEvent.click(
      within(within(region).getByText("Interviews").closest(".rounded-xl") as HTMLElement).getByRole("button", {
        name: "Manage Permissions",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Enable All" }));
    expect(screen.getByText("4/4 enabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Schedule interviews" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Cancel interviews" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Disable All" }));
    expect(screen.getByText("0/4 enabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Schedule interviews" })).not.toBeChecked();
  });

  it("Cancel discards the local draft entirely -- neither onSave nor onPermissionsChange fire, and reopening shows the original state", async () => {
    const { onSave, onPermissionsChange } = renderCards({ permissions: ["VIEW_VACANCY"] });
    const region = categoriesRegion();
    const vacancyCard = within(region).getByText("Vacancy Management").closest(".rounded-xl") as HTMLElement;
    await userEvent.click(within(vacancyCard).getByRole("button", { name: "Manage Permissions" }));

    await userEvent.click(screen.getByRole("switch", { name: "Create vacancy requests" }));
    expect(screen.getByRole("switch", { name: "Create vacancy requests" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(onPermissionsChange).not.toHaveBeenCalled();

    await userEvent.click(within(vacancyCard).getByRole("button", { name: "Manage Permissions" }));
    expect(screen.getByRole("switch", { name: "Create vacancy requests" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "View vacancies" })).toBeChecked();
  });

  it("Save merges this category's draft into the full permission set, calls onSave once, and only updates/closes on success", async () => {
    const onSave = vi.fn((_permissions: Permission[], options: { onSuccess: () => void }) => options.onSuccess());
    const onPermissionsChange = vi.fn();
    render(
      <PermissionCategoryCards
        permissions={["VIEW_VACANCY", "MANAGE_USERS"]}
        onPermissionsChange={onPermissionsChange}
        onSave={onSave}
        isSaving={false}
        saveError={null}
      />,
    );
    const region = categoriesRegion();
    const recruitmentCard = within(region).getByText("Recruitment").closest(".rounded-xl") as HTMLElement;
    await userEvent.click(within(recruitmentCard).getByRole("button", { name: "Manage Permissions" }));

    await userEvent.click(screen.getByRole("switch", { name: "Job distribution" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [savedPermissions] = onSave.mock.calls[0];
    // Untouched categories' grants (VIEW_VACANCY, MANAGE_USERS) survive the
    // merge; JOB_DISTRIBUTION (Recruitment) is newly added; every other
    // Recruitment permission stays off.
    expect(new Set(savedPermissions)).toEqual(new Set(["VIEW_VACANCY", "MANAGE_USERS", "JOB_DISTRIBUTION"]));
    expect(onPermissionsChange).toHaveBeenCalledWith(savedPermissions);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the inline save error and keeps the drawer open on failure", async () => {
    renderCards({ saveError: "Update failed" });
    const region = categoriesRegion();
    await userEvent.click(
      within(within(region).getByText("System").closest(".rounded-xl") as HTMLElement).getByRole("button", {
        name: "Manage Permissions",
      }),
    );

    expect(screen.getByText("Update failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables Save/Cancel and shows 'Saving…' while a save is pending", async () => {
    renderCards({ isSaving: true });
    const region = categoriesRegion();
    await userEvent.click(
      within(within(region).getByText("System").closest(".rounded-xl") as HTMLElement).getByRole("button", {
        name: "Manage Permissions",
      }),
    );

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
