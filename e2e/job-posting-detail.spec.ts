import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

import { apiBase, closeAuthedContext, expectSignedIn, openAuthedContext, tokens } from "./auth";

/**
 * The job posting DETAIL screen in a real browser (2026-09-24).
 *
 * screens-smoke.spec.ts already opens the job postings LIST. The detail page
 * is where this module actually lives -- the content editor, the AI draft
 * button, the channel panel, the history and the audit trail -- and until now
 * it had never been rendered anywhere but jsdom. That matters here more than
 * usual: `PostingChannelsPanel` shows a status whose label is computed from a
 * DERIVED configuration status, so a channel that is merely unconfigured and
 * one that genuinely failed must not read alike, and no jsdom test compares
 * what a person sees.
 *
 * READ-ONLY, like every spec in this directory. The default base URL is
 * production. Nothing is clicked that edits, generates, approves, publishes
 * or closes anything -- the assertions stop at which controls are ON SCREEN.
 * The state machine itself is covered by tests/test_job_posting_workflow.py
 * against a throwaway database.
 *
 * FIXTURES ARE DISCOVERED, NOT HARD-CODED: the list endpoint says what exists
 * in this environment, and with no postings at all the tests skip rather than
 * fail on data they cannot control.
 *
 * Auth: see ./auth.ts. Skipped entirely without E2E_TOKENS.
 */

interface PostingSummary {
  id: string;
  posting_number: string | null;
  position_title: string;
  status: string;
}

/** Copy the app shows when a query or mutation fails. Mirrors screens-smoke. */
const ERROR_COPY = /Something went wrong|Failed to load|Unable to load|An error occurred|Internal Server Error/i;

/** Sections A-J of the detail screen, by the heading each one renders. */
const SECTIONS = [
  /Job information/i,
  /Job description/i,
  /Positions/i,
  /Application details/i,
  /Publish to/i,
  /Channel status/i,
  /Posting history/i,
  /Audit information/i,
];

let postings: PostingSummary[] = [];
let context: BrowserContext | undefined;
let page: Page | undefined;

async function loadPostings(request: APIRequestContext, baseURL: string | undefined) {
  const response = await request.get(`${apiBase(baseURL)}/api/v1/job-postings?limit=25`, {
    headers: { Authorization: `Bearer ${tokens!.access_token}` },
  });
  expect(response.ok(), `job postings list: HTTP ${response.status()}`).toBeTruthy();
  return (await response.json()).items as PostingSummary[];
}

function skipUnlessAuthed() {
  test.skip(!tokens, "E2E_TOKENS not set -- no session to drive the app with.");
}

test.beforeAll(async ({ browser, request, baseURL }) => {
  skipUnlessAuthed();
  postings = await loadPostings(request, baseURL);
  ({ context, page } = await openAuthedContext(browser, { baseURL }));
});

test.afterAll(async () => {
  await closeAuthedContext(context, page);
});

test("the detail screen renders every section for a real posting", async () => {
  skipUnlessAuthed();
  test.skip(postings.length === 0, "No job postings in this environment.");
  const posting = postings[0];

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page!.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page!.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/v1/")) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page!.goto(`/job-postings/${posting.id}`);
  await expectSignedIn(page!);

  // The posting identifies itself: its number, or its position title when it
  // has never been published and so has no number yet.
  await expect(
    page!.getByText(posting.posting_number ?? posting.position_title, { exact: false }).first(),
  ).toBeVisible();

  for (const heading of SECTIONS) {
    await expect(page!.getByText(heading).first(), `section ${heading} is missing`).toBeVisible();
  }

  await page!.screenshot({ path: `e2e-screens/job-posting-detail.png`, fullPage: true });
  expect(consoleErrors, "browser console errors").toEqual([]);
  expect(failedRequests, "failed API calls").toEqual([]);
  await expect(page!.getByText(ERROR_COPY)).toHaveCount(0);
});

test("the three position counts are shown and agree with the API", async ({ request, baseURL }) => {
  skipUnlessAuthed();
  test.skip(postings.length === 0, "No job postings in this environment.");
  const posting = postings[0];

  const response = await request.get(`${apiBase(baseURL)}/api/v1/job-postings/${posting.id}`, {
    headers: { Authorization: `Bearer ${tokens!.access_token}` },
  });
  expect(response.ok()).toBeTruthy();
  const detail = await response.json();

  // Read-only derived values (positions_requested/filled/remaining). If the
  // screen and the API disagree, one of them is computing rather than reading.
  expect(detail.positions_requested - detail.positions_filled).toBe(detail.positions_remaining);

  await page!.goto(`/job-postings/${posting.id}`);
  await expectSignedIn(page!);
  const positions = page!.locator("section, div").filter({ hasText: /Positions/i }).first();
  await expect(positions).toContainText(String(detail.positions_requested));
  await expect(positions).toContainText(String(detail.positions_remaining));
});

test("an unconfigured channel says so instead of looking published", async () => {
  skipUnlessAuthed();
  test.skip(postings.length === 0, "No job postings in this environment.");

  await page!.goto(`/job-postings/${postings[0].id}`);
  await expectSignedIn(page!);

  // WAIT FOR THE PANEL, do not merely arrive at the route. An earlier version
  // of this test ran its checks against the app's "Loading..." splash: every
  // locator matched nothing, the count-guard below was trivially false, and it
  // passed green having asserted nothing at all. The screenshot is what showed
  // it. Never screenshot or count before something real is on screen.
  const heading = page!.getByText(/Channel status/i).first();
  await expect(heading).toBeVisible();
  const channels = page!.locator("div").filter({ has: heading }).last();

  // Whatever state this environment's channels are in, the panel must never
  // show a channel as published while also saying its integration is absent --
  // the one thing §11 forbids, and the one thing a rendered page can prove.
  const notConfigured = channels.getByText(/not configured/i);
  const unconfiguredCount = await notConfigured.count();
  for (let i = 0; i < unconfiguredCount; i += 1) {
    const row = notConfigured.nth(i).locator("xpath=ancestor::*[self::li or self::tr or self::div][1]");
    await expect(row).not.toContainText(/Published/i);
  }
  // Say so rather than passing silently: with no channel rows attached in this
  // environment the loop above proved nothing, and the log should admit it.
  console.log(`channel rows showing "not configured": ${unconfiguredCount}`);
  await page!.screenshot({ path: `e2e-screens/job-posting-channels.png`, fullPage: true });
});
