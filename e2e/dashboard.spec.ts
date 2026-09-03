import { test, expect, type Page, type BrowserContext } from "@playwright/test";

import { apiBase, closeAuthedContext, expectSignedIn, openAuthedContext, tokens } from "./auth";

/**
 * The Executive Dashboard's KPI tiles, checked against the API they are fed
 * from. The tiles are the numbers management reads; a tile that silently
 * shows a different figure than /dashboard/kpis returns (a stale cache, a
 * client-side recomputation, a mislabelled card) is exactly the kind of
 * defect a jsdom test with a mocked API cannot see.
 *
 * Read-only. Auth: see ./auth.ts.
 */

let context: BrowserContext;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.skip(tokens === null, "E2E_TOKENS not set -- see scripts/e2e_mint_tokens.py");
  ({ context, page } = await openAuthedContext(browser, { viewport: { width: 1280, height: 1400 } }));
});

test.afterAll(async () => {
  await closeAuthedContext(context, page);
});

/** Tile label -> the /dashboard/kpis field it must show. */
const TILES: [string, string][] = [
  ["Total Sanctioned", "sanctioned_approved_total"],
  ["Working", "sanctioned_working_total"],
  ["Vacancies", "sanctioned_vacancy_total"],
  ["Recruitment Required", "recruitment_required_count"],
  ["Pending Requests", "pending_requests_count"],
  ["Pending Approvals", "pending_approvals_count"],
  ["Total applications", "total_applications"],
  ["Active Recruitment", "open_positions"],
  ["Offers pending", "offers_pending"],
];

/** The tile's number, as its own token: "Total applications5" must match 5
 * but "16" must not. `\b` is useless here because a letter and a digit are
 * both word characters. */
function standalone(n: number): RegExp {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`);
}

test("KPI tiles show exactly what /dashboard/kpis returns", async ({ request, baseURL }) => {
  const response = await request.get(`${apiBase(baseURL)}/api/v1/dashboard/kpis`, {
    headers: { Authorization: `Bearer ${tokens!.access_token}` },
  });
  expect(response.ok()).toBeTruthy();
  const kpis: Record<string, number> = await response.json();

  await page.goto("/dashboard");
  await expectSignedIn(page);
  await expect(page.getByRole("heading", { name: "Executive Dashboard" })).toBeVisible();
  await expect(page.getByTestId("primary-kpi-grid")).toBeVisible();

  // The tiles live in the primary grid and the wrap strip right after it.
  // Scoping to those keeps a label like "Working" from also matching the
  // strength table's column header further down the page.
  const primary = page.getByTestId("primary-kpi-grid");
  const secondary = primary.locator("xpath=following-sibling::div[1]");
  const region = primary.or(secondary);

  for (const [label, field] of TILES) {
    const tile = region
      .getByText(label, { exact: true })
      .locator("xpath=ancestor::*[contains(@class, 'rounded')][1]");
    await expect(tile, label).toBeVisible();
    await expect(tile, `${label} should read ${kpis[field]}`).toContainText(standalone(kpis[field]));
  }
});

test("the category tabs rescope the tiles rather than hiding them", async () => {
  await page.goto("/dashboard");
  await expectSignedIn(page);
  await page.getByRole("tab", { name: /^Teaching/ }).click();
  await expect(page.getByRole("tab", { name: /^Teaching/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("primary-kpi-grid")).toBeVisible();
  await expect(page.getByText("Total Sanctioned", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page.getByText("Total Sanctioned", { exact: true })).toBeVisible();
});
