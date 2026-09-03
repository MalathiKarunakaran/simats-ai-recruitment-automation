import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";

import { apiBase, closeAuthedContext, expectSignedIn, openAuthedContext, tokens } from "./auth";

/**
 * The authenticated vacancy-request wizard (/vacancy-requests/new), driven in
 * a real browser.
 *
 * NOTHING HERE SUBMITS -- every test stops at the "Submit vacancy request"
 * button's enabled state, for the same reason as the public-form spec: the
 * default target is production.
 *
 * Auth and the one-context-per-file rule are explained in ./auth.ts.
 *
 * The user must be a SUPER_ADMIN: the wizard only shows the Campus picker to
 * that role (everyone else is locked to their own campus), and these tests
 * need to reach both a campus with locations and one without.
 */

const EM_DASH = "—";
const WIZARD = "/vacancy-requests/new";

interface Campus {
  id: string;
  code: string;
  is_active: boolean;
}
interface Department {
  id: string;
  name: string;
  campus_id: string;
  is_active: boolean;
  supported_categories: string[];
}
interface Designation {
  id: string;
  name: string;
  category: string;
  is_active: boolean;
}
interface Location {
  id: string;
  name: string;
  block_building: string | null;
  floor_venue: string | null;
  campus_id: string;
  is_active: boolean;
}

interface Fixtures {
  campusWithLocations: string;
  teachingDepartment: string;
  teachingDesignation: string;
  teachingDesignationNames: Set<string>;
  aLocation: string;
  campusWithoutLocations: string | null;
  otherDepartment: string | null;
  otherDesignation: string | null;
  otherCategoryLabel: string | null;
}

let fx: Fixtures;
let context: BrowserContext;
let page: Page;

test.describe.configure({ mode: "serial" });

/** Mirrors `locationLabel` in frontend/src/lib/locationDisplay.ts. */
function label(l: Location): string {
  const block = (l.block_building ?? "").trim() || (l.name ?? "").trim();
  const floor = (l.floor_venue ?? "").trim();
  return block && floor ? `${block} ${EM_DASH} ${floor}` : block || floor || (l.name ?? "").trim();
}

const CATEGORY_LABEL: Record<string, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  HOUSEKEEPING: "Housekeeping",
};

async function discover(request: APIRequestContext, baseURL: string | undefined): Promise<Fixtures> {
  const api = apiBase(baseURL);
  const headers = { Authorization: `Bearer ${tokens!.access_token}` };
  const items = async <T,>(path: string): Promise<T[]> => {
    const response = await request.get(`${api}/api/v1${path}`, { headers });
    expect(response.ok(), `${path} -> ${response.status()}`).toBeTruthy();
    return (await response.json()).items;
  };

  const campuses = (await items<Campus>("/campuses?limit=50")).filter((c) => c.is_active);
  const departments = (await items<Department>("/departments?limit=200")).filter((d) => d.is_active);
  const locations = (await items<Location>("/locations?limit=200&include_inactive=true")).filter((l) => l.is_active);

  const campusIdsWithLocations = new Set(locations.map((l) => l.campus_id));

  // The wizard's Designation step lists designations LINKED to the chosen
  // department (a many-to-many), so a department is only usable here if at
  // least one TEACHING designation is actually attached to it.
  let picked: { campus: Campus; department: Department; designations: Designation[] } | null = null;
  for (const campus of campuses.filter((c) => campusIdsWithLocations.has(c.id))) {
    for (const department of departments.filter(
      (d) => d.campus_id === campus.id && d.supported_categories.includes("TEACHING"),
    )) {
      const designations = (
        await items<Designation>(`/designations?department_id=${department.id}&category=TEACHING&is_active=true&limit=200`)
      ).filter((d) => d.is_active);
      if (designations.length > 0) {
        picked = { campus, department, designations };
        break;
      }
    }
    if (picked) break;
  }
  expect(picked, "no campus with locations has a TEACHING department with a linked designation").toBeTruthy();

  let other: { campus: Campus; department: Department; designation: Designation } | null = null;
  for (const campus of campuses.filter((c) => !campusIdsWithLocations.has(c.id))) {
    for (const department of departments.filter((d) => d.campus_id === campus.id)) {
      for (const category of department.supported_categories) {
        const designations = (
          await items<Designation>(`/designations?department_id=${department.id}&category=${category}&is_active=true&limit=200`)
        ).filter((d) => d.is_active);
        if (designations.length > 0) {
          other = { campus, department, designation: designations[0] };
          break;
        }
      }
      if (other) break;
    }
    if (other) break;
  }

  return {
    campusWithLocations: picked!.campus.code,
    teachingDepartment: picked!.department.name,
    teachingDesignation: picked!.designations[0].name,
    teachingDesignationNames: new Set(picked!.designations.map((d) => d.name)),
    aLocation: label(locations.find((l) => l.campus_id === picked!.campus.id)!),
    campusWithoutLocations: other?.campus.code ?? null,
    otherDepartment: other?.department.name ?? null,
    otherDesignation: other?.designation.name ?? null,
    otherCategoryLabel: other ? CATEGORY_LABEL[other.designation.category] : null,
  };
}

test.beforeAll(async ({ browser, request, baseURL }) => {
  test.skip(tokens === null, "E2E_TOKENS not set -- see scripts/e2e_mint_tokens.py");
  fx = await discover(request, baseURL);
  ({ context, page } = await openAuthedContext(browser));
});

test.afterAll(async () => {
  await closeAuthedContext(context, page);
});

async function openWizard() {
  await page.goto(WIZARD);
  await expectSignedIn(page);
  await expect(page.getByText("1. Teaching / Non-Teaching")).toBeVisible();
}

function nextButton() {
  return page.getByRole("button", { name: "Next", exact: true });
}
function submitButton() {
  return page.getByRole("button", { name: "Submit vacancy request" });
}
function locationTrigger() {
  return page.getByRole("combobox", { name: "Location", exact: true });
}

/** The app shell's header has its own campus switcher, a combobox listing
 * the same campus codes as the wizard's Campus step. Unscoped, `nth(0)`
 * lands on the header and the wizard's own picker is never set. */
function wizardCombobox(index: number) {
  return page.getByRole("main").getByRole("combobox").nth(index);
}

async function choose(combobox: ReturnType<Page["getByRole"]>, option: string) {
  await combobox.click();
  const item = page.getByRole("option", { name: option, exact: true });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

/** Steps 0-5, leaving the wizard on the final "Remarks & Submit" step. */
async function walkToLastStep(opts: {
  category: string;
  campus: string;
  department: string;
  designation: string;
}) {
  await page.getByRole("button", { name: opts.category, exact: false }).first().click();
  await nextButton().click();

  // Step 1: the Campus and Department triggers carry no aria-label; they are
  // the only two comboboxes on this step, in that order.
  await choose(wizardCombobox(0), opts.campus);
  await choose(wizardCombobox(1), opts.department);
  await nextButton().click();

  await page.getByRole("button", { name: opts.designation, exact: false }).click();
  await nextButton().click();

  // Each step is asserted by its own content before Next is clicked. The
  // step chips at the top are ALL always visible, so "7. Remarks & Submit"
  // being on screen proves nothing -- and a Next clicked mid-render simply
  // does not register.
  await expect(page.locator("#requested_count")).toHaveValue("1");
  await nextButton().click();
  await expect(page.getByText("Employment type", { exact: true })).toBeVisible(); // pre-filled from the designation
  await nextButton().click();
  await expect(page.getByText("Priority", { exact: true })).toBeVisible(); // defaults to NORMAL
  await nextButton().click();
  await expect(page.getByText("Justification / Remarks (optional)")).toBeVisible();
}

test.describe("Session bootstrap", () => {
  test("a stored refresh token lands on the wizard, not /login", async () => {
    await openWizard();
    await expect(page.getByText("What kind of position is this?")).toBeVisible();
  });
});

test.describe("Step gating", () => {
  test("Next is disabled until a category is picked", async () => {
    await openWizard();
    await expect(nextButton()).toBeDisabled();
    await page.getByRole("button", { name: "Teaching", exact: false }).first().click();
    await expect(nextButton()).toBeEnabled();
  });

  test("Next is disabled on the department step until both pickers are set", async () => {
    await openWizard();
    await page.getByRole("button", { name: "Teaching", exact: false }).first().click();
    await nextButton().click();
    await expect(nextButton()).toBeDisabled();
    await choose(wizardCombobox(0), fx.campusWithLocations);
    await expect(nextButton()).toBeDisabled();
    await choose(wizardCombobox(1), fx.teachingDepartment);
    await expect(nextButton()).toBeEnabled();
  });

  test("the designation step only offers designations of the chosen category", async () => {
    await openWizard();
    await page.getByRole("button", { name: "Teaching", exact: false }).first().click();
    await nextButton().click();
    await choose(wizardCombobox(0), fx.campusWithLocations);
    await choose(wizardCombobox(1), fx.teachingDepartment);
    await nextButton().click();

    await expect(page.getByRole("button", { name: fx.teachingDesignation, exact: false })).toBeVisible();
    // Every designation card on this step must be one the API returned for
    // (department, TEACHING) -- no Non-Teaching post leaking in.
    const cards = page.locator("button.rounded-lg.border span.font-medium");
    const names = await cards.allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(fx.teachingDesignationNames.has(name.trim()), name).toBe(true);
  });

  test("a required count of 0 blocks Next", async () => {
    await openWizard();
    await page.getByRole("button", { name: "Teaching", exact: false }).first().click();
    await nextButton().click();
    await choose(wizardCombobox(0), fx.campusWithLocations);
    await choose(wizardCombobox(1), fx.teachingDepartment);
    await nextButton().click();
    await page.getByRole("button", { name: fx.teachingDesignation, exact: false }).click();
    await nextButton().click();

    await page.locator("#requested_count").fill("0");
    await expect(nextButton()).toBeDisabled();
    await page.locator("#requested_count").fill("2");
    await expect(nextButton()).toBeEnabled();
  });
});

test.describe("Location on the final step", () => {
  test("is required, with no 'Not specified' escape hatch, on a campus that has locations", async () => {
    await openWizard();
    await walkToLastStep({
      category: "Teaching",
      campus: fx.campusWithLocations,
      department: fx.teachingDepartment,
      designation: fx.teachingDesignation,
    });

    await expect(locationTrigger()).toHaveAttribute("aria-required", "true");
    await expect(page.getByText("No locations are set up for this campus")).toHaveCount(0);
    // Everything else is valid; Location alone holds the submit.
    await expect(submitButton()).toBeDisabled();

    await locationTrigger().click();
    await expect(page.getByRole("option", { name: "Not specified", exact: true })).toHaveCount(0);
    const option = page.getByRole("option", { name: fx.aLocation, exact: true });
    await option.scrollIntoViewIfNeeded();
    await option.click();

    await expect(submitButton()).toBeEnabled();
    // The summary reflects the choice, so the requester sees what will be sent.
    await expect(page.locator("dd", { hasText: fx.aLocation })).toBeVisible();
  });

  test("is optional, and offers 'Not specified', on a campus that has none", async () => {
    test.skip(
      fx.campusWithoutLocations === null || fx.otherDepartment === null,
      "no campus without locations has a department with a linked designation",
    );
    await openWizard();
    await walkToLastStep({
      category: fx.otherCategoryLabel!,
      campus: fx.campusWithoutLocations!,
      department: fx.otherDepartment!,
      designation: fx.otherDesignation!,
    });

    await expect(locationTrigger()).toHaveAttribute("aria-required", "false");
    await expect(page.getByText("Location (optional)")).toBeVisible();
    await expect(
      page.getByText("No locations are set up for this campus yet, so this is not required."),
    ).toBeVisible();
    await expect(submitButton()).toBeEnabled();

    await locationTrigger().click();
    await expect(page.getByRole("option", { name: "Not specified", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
