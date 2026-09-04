import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * The public QR vacancy-request form, driven in a real browser.
 *
 * NOTHING HERE SUBMITS. Every test stops at asserting the Submit button's
 * enabled/disabled state, because the default base URL is PRODUCTION and a
 * click would create a real DRAFT vacancy request that a human would then
 * have to go and delete. The submit path itself is covered by
 * `tests/test_public_vacancy_requests.py` against a throwaway database.
 *
 * These exist because the jsdom Vitest suite renders components in isolation
 * and never told us whether the built bundle actually served from
 * app.malathi.io behaves. It earned its keep immediately: it caught that
 * SelectContent had no max-height, so a 53-item department list rendered
 * 1757px tall in a 720px window with nothing scrollable and two thirds of the
 * options physically unreachable.
 *
 * FIXTURES ARE DISCOVERED, NOT HARD-CODED. Local dev and production hold
 * different master data -- different campuses have locations, the blocks are
 * named differently, and departments present in one are absent from the
 * other. Reading form-options at startup is what lets the same spec verify
 * both, and stops the suite rotting the next time HR edits a department.
 */

const EM_DASH = "—";
const FORM = "/vacancy-request/public";

interface Options {
  campuses: { id: string; code: string; name: string }[];
  departments: { id: string; name: string; campus_id: string; supported_categories: string[] }[];
  designations: { id: string; name: string; category: string }[];
  locations: { id: string; name: string; block_building: string | null; floor_venue: string | null; campus_id: string }[];
}

interface Fixtures {
  campusWithLocations: RegExp;
  campusWithoutLocations: RegExp;
  aLocation: string;
  teachingDepartment: string;
  nonTeachingDepartment: string | null;
  teachingDesignation: string;
  nonTeachingDesignation: string;
  /** A department on the no-locations campus, and a designation its
   * supported_categories actually allow -- picking "any first option" broke
   * the moment that campus's first department was NON_TEACHING-only. */
  otherCampusDepartment: string | null;
  otherCampusDesignation: string | null;
}

let fx: Fixtures;

/** Mirrors `locationLabel` in frontend/src/lib/locationDisplay.ts. */
function label(l: Options["locations"][number]): string {
  const block = (l.block_building ?? "").trim() || (l.name ?? "").trim();
  const floor = (l.floor_venue ?? "").trim();
  return block && floor ? `${block} ${EM_DASH} ${floor}` : block || floor || (l.name ?? "").trim();
}

/** A campus option renders `{code} — {name}`, and on production the stored
 * `name` used to begin "Campus — {code} - " as well. Matching on the code
 * prefix survives both that and any future tidy-up of the names. */
function byCode(code: string): RegExp {
  return new RegExp(`^${code}\\b`);
}

async function loadOptions(request: APIRequestContext, baseURL: string | undefined): Promise<Options> {
  const api =
    process.env.E2E_API_URL ??
    (baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1")
      ? "http://127.0.0.1:8000"
      : "https://api.malathi.io");
  const response = await request.get(`${api}/api/v1/public/vacancy-requests/form-options`);
  expect(response.ok(), `form-options unreachable at ${api}`).toBeTruthy();
  return response.json();
}

test.beforeAll(async ({ request, baseURL }) => {
  const options = await loadOptions(request, baseURL);

  const campusIdsWithLocations = new Set(options.locations.map((l) => l.campus_id));
  const withLocations = options.campuses.find((c) => campusIdsWithLocations.has(c.id));
  const withoutLocations = options.campuses.find((c) => !campusIdsWithLocations.has(c.id));
  expect(withLocations, "no campus has any locations -- nothing to test the required rule against").toBeTruthy();
  expect(withoutLocations, "every campus has locations -- nothing to test the optional rule against").toBeTruthy();

  const here = (d: Options["departments"][number]) => d.campus_id === withLocations!.id;
  const teachingDepartment = options.departments.find((d) => here(d) && d.supported_categories.includes("TEACHING"));
  const nonTeachingDepartment = options.departments.find(
    (d) => here(d) && d.supported_categories.length === 1 && d.supported_categories[0] === "NON_TEACHING",
  );
  const teachingDesignation = options.designations.find((d) => d.category === "TEACHING");
  const nonTeachingDesignation = options.designations.find((d) => d.category === "NON_TEACHING");

  expect(teachingDepartment, "no TEACHING department to test with").toBeTruthy();
  expect(teachingDesignation, "no TEACHING designation to test with").toBeTruthy();
  expect(nonTeachingDesignation, "no NON_TEACHING designation to test with").toBeTruthy();

  const otherCampusDepartment = options.departments.find((d) => d.campus_id === withoutLocations!.id);
  const otherCampusDesignation = otherCampusDepartment
    ? options.designations.find((d) => otherCampusDepartment.supported_categories.includes(d.category))
    : undefined;

  fx = {
    campusWithLocations: byCode(withLocations!.code),
    campusWithoutLocations: byCode(withoutLocations!.code),
    aLocation: label(options.locations.find((l) => l.campus_id === withLocations!.id)!),
    teachingDepartment: teachingDepartment!.name,
    // Not every environment has one; the test that needs it skips rather
    // than failing on data it cannot control.
    nonTeachingDepartment: nonTeachingDepartment?.name ?? null,
    teachingDesignation: teachingDesignation!.name,
    nonTeachingDesignation: nonTeachingDesignation!.name,
    otherCampusDepartment: otherCampusDepartment?.name ?? null,
    otherCampusDesignation: otherCampusDesignation?.name ?? null,
  };
});

/**
 * Radix Select is a button + portalled listbox, not a <select>, so
 * `selectOption` does not apply. The list scrolls inside its own viewport
 * (see the max-height fix in components/ui/select.tsx), which is why the
 * option is scrolled into view before being clicked.
 */
async function choose(page: Page, field: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: field, exact: true }).click();
  // `exact` applies to string matching only; a RegExp is already as precise
  // as its author made it, and Playwright rejects the combination.
  const item =
    typeof option === "string"
      ? page.getByRole("option", { name: option, exact: true })
      : page.getByRole("option", { name: option });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

function submitButton(page: Page) {
  return page.getByRole("button", { name: "Submit request" });
}

function locationTrigger(page: Page) {
  return page.getByRole("combobox", { name: "Location", exact: true });
}

/** Everything except campus/department/designation/location, all valid. */
async function fillTheRest(page: Page) {
  await page.locator("#positions").fill("2");
  await page.locator("#justification").fill("Replacement for a resignation this quarter.");
  await page.locator("#requester-name").fill("Test Requester");
  await page.locator("#requester-email").fill("test.requester@example.com");
  await page.locator("#requester-mobile").fill("9876543210");
}

test.beforeEach(async ({ page }) => {
  await page.goto(FORM);
  await expect(page.getByRole("heading", { name: "Vacancy Request" })).toBeVisible();
  // The campus list arrives from the API; every other field depends on it.
  await expect(page.getByRole("combobox", { name: "Campus", exact: true })).toBeEnabled();
});

test.describe("Every option in a long list is reachable", () => {
  // The regression that motivated this file: with no max-height on the
  // popper, the department list ran off the bottom of the window and could
  // not be scrolled -- on production, 53 departments in a 720px viewport.
  test("the department list scrolls instead of overflowing the window", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await page.getByRole("combobox", { name: "Department", exact: true }).click();
    // The listbox is portalled in on the next tick; measuring before it
    // exists counts zero options and proves nothing.
    await expect(page.getByRole("option").first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector("[data-radix-select-viewport]") as HTMLElement | null;
      const options = [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
      return {
        count: options.length,
        height: viewport?.getBoundingClientRect().height ?? 0,
        scrollable: viewport ? viewport.scrollHeight > viewport.clientHeight : false,
        windowHeight: window.innerHeight,
      };
    });

    expect(geometry.count).toBeGreaterThan(10);
    expect(geometry.height).toBeLessThanOrEqual(geometry.windowHeight);
    // Taller than the window means it MUST scroll internally, or the tail of
    // the list is unreachable by any means.
    expect(geometry.scrollable).toBe(true);
    await page.keyboard.press("Escape");
  });

  test("the last department in the list can actually be clicked", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await page.getByRole("combobox", { name: "Department", exact: true }).click();
    const last = page.getByRole("option").last();
    const name = ((await last.textContent()) ?? "").trim();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.getByRole("combobox", { name: "Department", exact: true })).toContainText(name);
  });
});

test.describe("Location, the conditional requirement", () => {
  test("is required, and populated, on a campus that has locations", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);

    await expect(locationTrigger(page)).toHaveAttribute("aria-required", "true");
    await expect(page.getByText("No locations are set up for this campus")).toHaveCount(0);

    await locationTrigger(page).click();
    await expect(page.getByRole("option", { name: fx.aLocation, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("is optional, and says why, on a campus that has none", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithoutLocations);

    await expect(locationTrigger(page)).toHaveAttribute("aria-required", "false");
    // Not a bare "(optional)" -- the Required-by label ends in that too.
    await expect(page.getByText("Location (optional)")).toBeVisible();
    await expect(
      page.getByText("No locations are set up for this campus yet, so this is not required."),
    ).toBeVisible();
  });

  test("blocks submission when the campus has locations and none is picked", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Department", fx.teachingDepartment);
    await choose(page, "Designation", fx.teachingDesignation);
    await fillTheRest(page);

    // Everything else is valid. Location alone is what holds it.
    await expect(submitButton(page)).toBeDisabled();

    await choose(page, "Location", fx.aLocation);
    await expect(submitButton(page)).toBeEnabled();
  });

  test("does not block submission on a campus with no locations", async ({ page }) => {
    test.skip(
      fx.otherCampusDepartment === null || fx.otherCampusDesignation === null,
      "the no-locations campus has no department, or none whose category any designation matches",
    );
    await choose(page, "Campus", fx.campusWithoutLocations);
    await choose(page, "Department", fx.otherCampusDepartment!);
    await choose(page, "Designation", fx.otherCampusDesignation!);
    await fillTheRest(page);

    // Location is left untouched, and that is the whole point.
    await expect(submitButton(page)).toBeEnabled();
  });

  test("is cleared when the campus changes", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Location", fx.aLocation);
    await expect(locationTrigger(page)).toContainText(fx.aLocation);

    await choose(page, "Campus", fx.campusWithoutLocations);
    // Carrying a location over to another campus would be rejected by the
    // server with "Location does not belong to the selected campus."
    await expect(locationTrigger(page)).not.toContainText(fx.aLocation);
  });
});

test.describe("Category is derived from the designation", () => {
  test("there is no Category field to fill in", async ({ page }) => {
    await expect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveCount(0);
    await expect(
      page.getByText("The category is taken from the designation, so it does not need choosing separately."),
    ).toBeVisible();
  });

  test("a NON_TEACHING-only department does not offer a teaching designation", async ({ page }) => {
    test.skip(fx.nonTeachingDepartment === null, "this environment has no NON_TEACHING-only department");
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Department", fx.nonTeachingDepartment!);

    await page.getByRole("combobox", { name: "Designation", exact: true }).click();
    // The original defect: this WAS selectable, and died as a late 400 from
    // the server instead of never being offered.
    await expect(page.getByRole("option", { name: fx.teachingDesignation, exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: fx.nonTeachingDesignation, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a teaching department does offer one, and the category follows", async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Department", fx.teachingDepartment);
    await choose(page, "Designation", fx.teachingDesignation);

    await expect(page.getByText("Category: TEACHING")).toBeVisible();
  });

  test("the designation is cleared when the department changes", async ({ page }) => {
    test.skip(fx.nonTeachingDepartment === null, "this environment has no NON_TEACHING-only department");
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Department", fx.teachingDepartment);
    await choose(page, "Designation", fx.teachingDesignation);
    await expect(page.getByText("Category: TEACHING")).toBeVisible();

    await choose(page, "Department", fx.nonTeachingDepartment!);
    // Keeping the professorship here would submit a TEACHING designation
    // against a NON_TEACHING-only department.
    await expect(page.getByText("Category: TEACHING")).toHaveCount(0);
  });
});

test.describe("Field validation", () => {
  test.beforeEach(async ({ page }) => {
    await choose(page, "Campus", fx.campusWithLocations);
    await choose(page, "Department", fx.teachingDepartment);
    await choose(page, "Designation", fx.teachingDesignation);
    await choose(page, "Location", fx.aLocation);
    await fillTheRest(page);
    // The baseline every case below then breaks in exactly one way.
    await expect(submitButton(page)).toBeEnabled();
  });

  for (const bad of ["0", "-1", "1.5"]) {
    test(`rejects ${JSON.stringify(bad)} positions`, async ({ page }) => {
      await page.locator("#positions").fill(bad);
      await expect(page.getByText("Enter a whole number from 1 to")).toBeVisible();
      await expect(submitButton(page)).toBeDisabled();
    });
  }

  test("rejects letters in the positions field", async ({ page }) => {
    // `fill` refuses to put non-numeric text into input[type=number], which
    // is exactly what a real browser does: the keystrokes are swallowed and
    // the value ends up EMPTY rather than "abc". Typing is therefore the only
    // way to reproduce what a user actually experiences here.
    const positions = page.locator("#positions");
    await positions.click();
    await positions.press("ControlOrMeta+a");
    await positions.pressSequentially("abc");

    await expect(positions).toHaveValue("");
    await expect(submitButton(page)).toBeDisabled();
  });

  test("rejects a justification under 10 characters", async ({ page }) => {
    await page.locator("#justification").fill("too short");
    await expect(page.getByText("Please give at least 10 characters of context.")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
  });

  test("rejects whitespace passed off as a justification", async ({ page }) => {
    await page.locator("#justification").fill("             ");
    await expect(submitButton(page)).toBeDisabled();
  });

  test("rejects a required-by date in the past", async ({ page }) => {
    await page.locator("#required-by").fill("2020-01-01");
    await expect(page.getByText("The required-by date cannot be in the past.")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
  });

  test("accepts an empty required-by, which is optional", async ({ page }) => {
    await page.locator("#required-by").fill("");
    await expect(submitButton(page)).toBeEnabled();
  });

  for (const bad of ["12345", "1234567890", "98765432101"]) {
    test(`rejects the mobile number ${bad}`, async ({ page }) => {
      await page.locator("#requester-mobile").fill(bad);
      await expect(page.getByText("Enter a valid 10-digit Indian mobile number.")).toBeVisible();
      await expect(submitButton(page)).toBeDisabled();
    });
  }

  test("accepts a +91-prefixed mobile number", async ({ page }) => {
    await page.locator("#requester-mobile").fill("+91 98765 43210");
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number.")).toHaveCount(0);
    await expect(submitButton(page)).toBeEnabled();
  });

  test("rejects a malformed email", async ({ page }) => {
    await page.locator("#requester-email").fill("not-an-email");
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
  });
});

test.describe("Abuse protection (audit L5)", () => {
  test("the honeypot field is present for bots but unreachable for people", async ({ page }) => {
    const honeypot = page.locator('input[name="website"]');
    await expect(honeypot).toHaveCount(1);
    await expect(honeypot).toBeHidden(); // off-screen: not visible, not in the layout a person sees
    await expect(honeypot).toHaveAttribute("tabindex", "-1");
    await expect(honeypot).toHaveAttribute("autocomplete", "off");
    await expect(honeypot).toHaveValue("");
    await expect(page.getByTestId("honeypot")).toHaveAttribute("aria-hidden", "true");
    // Tabbing through the whole form never lands on it.
    await page.getByLabel(/name/i).first().focus();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const focusedName = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? "");
      expect(focusedName).not.toBe("website");
    }
  });
});
