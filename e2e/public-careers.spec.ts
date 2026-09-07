import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The public careers pages, driven in a real browser (2026-09-07).
 *
 * NOTHING HERE SUBMITS. The default base URL is production, and a submitted
 * application would create a real candidate and application row. Every test
 * stops at the Submit button's enabled/disabled state; the apply path itself
 * is covered by `tests/test_public_careers.py` against a throwaway database.
 *
 * FIXTURES ARE DISCOVERED, NOT HARD-CODED: the list endpoint says what is
 * open in this environment. With nothing open (possible on production
 * between hiring rounds) the list test asserts the empty state and the
 * detail tests skip rather than fail on data they cannot control.
 */

const LIST = "/careers";

interface Summary {
  posting_number: string | null;
  public_apply_slug: string;
  title: string;
  campus_code: string;
}

let open: Summary[] = [];

/** A slug is derived from the position title, so it can carry regex
 * metacharacters -- "(eligibility-demo)" in the seeded data, for one. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadOpenPostings(request: APIRequestContext, baseURL: string | undefined): Promise<Summary[]> {
  const api =
    process.env.E2E_API_URL ??
    (baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1")
      ? "http://127.0.0.1:8000"
      : "https://api.malathi.io");
  const response = await request.get(`${api}/api/v1/public/careers/postings`);
  expect(response.ok(), `careers list unreachable at ${api}`).toBeTruthy();
  return (await response.json()).items;
}

test.beforeAll(async ({ request, baseURL }) => {
  open = await loadOpenPostings(request, baseURL);
});

test("the careers list renders without signing in", async ({ page }) => {
  await page.goto(LIST);
  await expect(page.getByRole("heading", { name: "Current openings" })).toBeVisible();
  // No staff navigation leaks onto the public page.
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);

  if (open.length === 0) {
    await expect(page.getByText(/no openings at the moment/i)).toBeVisible();
  } else {
    for (const posting of open.slice(0, 3)) {
      await expect(page.getByRole("link", { name: `${posting.title} at ${posting.campus_code}` })).toBeVisible();
    }
  }
});

test("a posting's page shows the ad and an apply form that will not submit empty", async ({ page }) => {
  test.skip(open.length === 0, "nothing is open in this environment");
  const posting = open[0];

  await page.goto(`${LIST}/${posting.public_apply_slug}`);

  await expect(page.getByRole("heading", { name: posting.title })).toBeVisible();
  if (posting.posting_number) await expect(page.getByText(posting.posting_number)).toBeVisible();
  await expect(page.getByRole("heading", { name: "About this position" })).toBeVisible();

  const submit = page.getByRole("button", { name: "Submit application" });
  await expect(submit).toBeDisabled();
  await page.locator("#full-name").fill("Test Candidate");
  await page.locator("#email").fill("test.candidate@example.com");
  // Still disabled: no resume. Nothing is uploaded, so nothing can be sent.
  await expect(submit).toBeDisabled();
  // The bot trap must be off-screen -- Playwright's own visibility check is
  // the assertion that a real browser lays it out where a person cannot see it.
  await expect(page.getByTestId("honeypot")).not.toBeInViewport();
});

test("the list links to the posting page and back", async ({ page }) => {
  test.skip(open.length === 0, "nothing is open in this environment");
  const posting = open[0];

  await page.goto(LIST);
  await page.getByRole("link", { name: `${posting.title} at ${posting.campus_code}` }).click();
  await expect(page).toHaveURL(new RegExp(`/careers/${escapeRegExp(encodeURIComponent(posting.public_apply_slug))}$`));
  await page.getByRole("link", { name: "All openings" }).click();
  await expect(page.getByRole("heading", { name: "Current openings" })).toBeVisible();
});

test("an unknown slug explains itself", async ({ page }) => {
  await page.goto(`${LIST}/this-posting-does-not-exist-0000`);
  await expect(page.getByRole("heading", { name: "Posting not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See all openings" })).toBeVisible();
});
