import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { apiBase, closeAuthedContext, expectSignedIn, openAuthedContext, tokens } from "./auth";

/**
 * Content-Security-Policy (audit M1). The policy is owned by
 * frontend/nginx.conf; this spec reads it from there so the two can never
 * drift.
 *
 * Against PRODUCTION the served document must carry exactly that header.
 * Against a LOCAL preview (vite preview sets no headers) the same policy is
 * injected onto every document response, so a violation shows up here
 * before it ships. Either way, the screens are then driven with the policy
 * active and the console must stay free of "Refused to ..." CSP reports.
 */

const NGINX_CONF = "frontend/nginx.conf";

function policyFromNginxConf(): string {
  const match = readFileSync(NGINX_CONF, "utf8").match(/set \$csp "([^"]+)";/);
  if (!match) throw new Error(`no 'set $csp "..."' in ${NGINX_CONF}`);
  return match[1];
}

const POLICY = policyFromNginxConf();

function isProduction(baseURL: string | undefined): boolean {
  return !(baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1"));
}

/** Locally the bundle calls the local API, not api.malathi.io, so the one
 * environment-specific source in the policy is swapped for it; every other
 * directive is applied verbatim. */
function localPolicy(baseURL: string | undefined): string {
  return POLICY.replace("https://api.malathi.io", new URL(apiBase(baseURL)).origin);
}

async function injectPolicyLocally(context: BrowserContext, baseURL: string | undefined) {
  if (isProduction(baseURL)) return;
  const policy = localPolicy(baseURL);
  await context.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if ((headers["content-type"] ?? "").includes("text/html")) {
      headers["content-security-policy"] = policy;
    }
    await route.fulfill({ response, headers });
  });
}

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  return violations;
}

test("the policy in nginx.conf is restrictive: no unsafe script, no wildcard sources", () => {
  expect(POLICY).toContain("default-src 'self'");
  expect(POLICY).toContain("script-src 'self'");
  expect(POLICY).toContain("frame-ancestors 'none'");
  expect(POLICY).toContain("object-src 'none'");
  expect(POLICY).not.toMatch(/script-src[^;]*unsafe/);
  expect(POLICY).not.toMatch(/\s\*[\s;]/);
});

test("production serves the document with exactly that header", async ({ request, baseURL }) => {
  test.skip(!isProduction(baseURL), "vite preview serves no headers; the policy is injected instead");
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toBe(POLICY);
  // index.html is fetched by its own location block, which must repeat it.
  const index = await request.get("/index.html");
  expect(index.headers()["content-security-policy"]).toBe(POLICY);
});

test("the login page renders under the policy with no CSP violation", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await injectPolicyLocally(context, baseURL);
  const page = await context.newPage();
  const violations = collectCspViolations(page);

  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible();
  await page.waitForTimeout(500);

  expect(violations).toEqual([]);
  await context.close();
});

test.describe("authenticated screens under the policy", () => {
  test.skip(tokens === null, "E2E_TOKENS not set -- see scripts/e2e_mint_tokens.py");

  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser, baseURL }) => {
    ({ context, page } = await openAuthedContext(browser, { viewport: { width: 1280, height: 1400 } }));
    await injectPolicyLocally(context, baseURL);
  });

  test.afterAll(async () => {
    await closeAuthedContext(context, page);
  });

  for (const path of ["/", "/vacancy-requests", "/sanctioned-strength", "/users"]) {
    test(`${path} loads with no CSP violation and stays signed in`, async () => {
      const violations = collectCspViolations(page!);
      await page!.goto(path);
      await expectSignedIn(page!);
      await page!.waitForLoadState("networkidle");
      await page!.waitForTimeout(500);
      expect(violations).toEqual([]);
    });
  }

  test("opening a dialog (Radix scroll-lock injects a style element) is allowed", async () => {
    const violations = collectCspViolations(page!);
    await page!.goto("/locations");
    await expectSignedIn(page!);
    await page!.getByRole("button", { name: "New location" }).click();
    await expect(page!.getByRole("dialog")).toBeVisible();
    await page!.keyboard.press("Escape");
    await expect(page!.getByRole("dialog")).toBeHidden();
    expect(violations).toEqual([]);
  });
});
