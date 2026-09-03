import { test, expect, type Page, type BrowserContext } from "@playwright/test";

import { closeAuthedContext, expectSignedIn, openAuthedContext, tokens } from "./auth";

/**
 * Every authenticated list/landing screen, opened once in a real browser as
 * a SUPER_ADMIN, checking the things jsdom cannot: that the page actually
 * renders (not bounced to /login), that nothing in it throws in the browser
 * console, that no API call it makes fails, and that no error copy is on
 * screen. A screenshot of each is kept in e2e-screens/ for a human look.
 *
 * Read-only. No button that creates, edits or deletes anything is pressed.
 *
 * Auth: see ./auth.ts. Skipped entirely without E2E_TOKENS.
 */

/** Route -> something that must be on screen once it has rendered. */
const SCREENS: { path: string; expectText: string | RegExp }[] = [
  { path: "/dashboard", expectText: "Executive Dashboard" },
  { path: "/sanctioned-strength", expectText: /Sanctioned Strength/i },
  { path: "/vacancy-requests", expectText: /Vacancy Requests/i },
  { path: "/vacancy-approvals", expectText: /Approvals/i },
  { path: "/job-postings", expectText: /Job Postings/i },
  { path: "/candidates", expectText: /Candidates/i },
  { path: "/applications", expectText: /Applications/i },
  { path: "/interviews", expectText: /Interviews/i },
  { path: "/offers", expectText: /Offers/i },
  { path: "/onboarding", expectText: /Onboarding/i },
  { path: "/employees", expectText: /Employees/i },
  { path: "/reports", expectText: /Reports/i },
  { path: "/import-tracker", expectText: /Import/i },
  { path: "/activity-log", expectText: /Activity/i },
  { path: "/users", expectText: /Users/i },
  { path: "/eligibility-rules", expectText: /Eligibility/i },
  { path: "/designations", expectText: /Designations/i },
  { path: "/campuses", expectText: /Campuses/i },
  { path: "/departments", expectText: /Departments/i },
  { path: "/locations", expectText: /Locations/i },
  { path: "/housekeeping-staff", expectText: /Housekeeping/i },
  { path: "/settings", expectText: /Settings/i },
];

// Copy the app itself shows when a query or mutation fails.
const ERROR_COPY = /Something went wrong|Failed to load|Unable to load|An error occurred|Internal Server Error/i;

let context: BrowserContext;
let page: Page;
const consoleErrors: string[] = [];
const failedRequests: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.skip(tokens === null, "E2E_TOKENS not set -- see scripts/e2e_mint_tokens.py");
  // The app shell scrolls inside <main>, not the document, so a fullPage
  // screenshot would still stop at the fold. A tall viewport is the only way
  // to get the whole screen into one image.
  ({ context, page } = await openAuthedContext(browser, { viewport: { width: 1280, height: 2600 } }));

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text()}`);
  });
  page.on("response", (response) => {
    // Only the app's own API calls; the preview server's 304s etc. are noise.
    if (response.url().includes("/api/v1/") && response.status() >= 400) {
      failedRequests.push(`${page.url()} :: ${response.request().method()} ${response.url()} -> ${response.status()}`);
    }
  });
});

test.afterAll(async () => {
  await closeAuthedContext(context, page);
});

for (const screen of SCREENS) {
  test(`${screen.path} renders cleanly`, async () => {
    consoleErrors.length = 0;
    failedRequests.length = 0;

    await page.goto(screen.path);
    await expectSignedIn(page);
    await expect(page.getByRole("main")).toContainText(screen.expectText);

    // Let every query on the page settle before judging it.
    await expect
      .poll(async () => page.getByRole("status").count(), { timeout: 15_000, message: "loading placeholders" })
      .toBe(0)
      .catch(() => {
        /* some screens keep a permanent role=status live region; the assertions below still apply */
      });
    await page.waitForLoadState("networkidle");

    // Outside test-results/, which Playwright empties at the start of every
    // run -- these are meant to be looked at after the fact.
    await page.screenshot({
      path: `e2e-screens/${screen.path.replace(/\//g, "_").replace(/^_/, "")}.png`,
      fullPage: true,
    });

    await expect(page.getByRole("main")).not.toContainText(ERROR_COPY);
    expect(failedRequests, "API calls that failed").toEqual([]);
    expect(consoleErrors, "browser console errors").toEqual([]);

    // A column that auto table layout has squeezed to nothing is invisible
    // to the user and to every jsdom test -- the Vacancy Requests list
    // shipped with its Position column at exactly 0px wide.
    const collapsedColumns = await page.evaluate(() =>
      [...document.querySelectorAll("main table thead th")]
        .filter((th) => th.getBoundingClientRect().width < 1 && (th.textContent ?? "").trim() !== "")
        .map((th) => th.textContent!.trim()),
    );
    expect(collapsedColumns, "table columns rendered at zero width").toEqual([]);
  });
}
