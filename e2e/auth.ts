import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Shared session handling for the authenticated specs.
 *
 * A browser cannot log in without a mailbox on an OTP-first deployment, so
 * `scripts/e2e_mint_tokens.py` issues a real token pair instead; the specs
 * read it from E2E_TOKENS. The refresh token becomes the same HttpOnly
 * cookie the backend sets on login (audit M1: it is never in localStorage
 * any more), placed in the browser's jar for the API host before the first
 * navigation; AuthContext's bootstrap then refreshes through it exactly as
 * it would for a real user. The access token is used for fixture discovery
 * only.
 *
 * REFRESH TOKENS ROTATE. Every bootstrap consumes the presented cookie and
 * the backend sets a new one; the old one is revoked. That has two
 * consequences this module exists to handle:
 *
 *  - Within a file, tests must share ONE browser context (a fresh context
 *    per test would replay the original, already-revoked token on test two).
 *  - Across files, the rotated token must outlive the context. It is read
 *    back out of the context's cookie jar and persisted to
 *    `playwright/.auth/refresh-token` (gitignored) when the context closes,
 *    and preferred over E2E_TOKENS when the next one opens. This only works
 *    with `--workers=1`, which is how these are run.
 *
 * Without E2E_TOKENS, `skipUnlessAuthed` skips the file rather than failing.
 */

/** Mirrors app/core/session_cookie.py. */
export const REFRESH_COOKIE_NAME = "simats_refresh_token";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
/** Mirrors frontend/src/api/client.ts -- required by /auth/refresh and /auth/logout. */
export const CSRF_HEADERS = { "X-Requested-With": "XMLHttpRequest" };
const ROTATED_TOKEN_FILE = "playwright/.auth/refresh-token";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  email: string;
  role: string;
}

export const tokens: Tokens | null = process.env.E2E_TOKENS ? JSON.parse(process.env.E2E_TOKENS) : null;

/** The API origin the FRONTEND BUNDLE calls -- the cookie must be set for
 * exactly that host or the browser will not attach it. Locally that is
 * http://localhost:8000 (frontend/.env.example's VITE_API_BASE_URL; the
 * cookie is SameSite=Strict and localhost:5173 -> localhost:8000 is
 * same-site, whereas 127.0.0.1 would be a different site). */
export function apiBase(baseURL: string | undefined): string {
  return (
    process.env.E2E_API_URL ??
    (baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1")
      ? "http://localhost:8000"
      : "https://api.malathi.io")
  );
}

/** The freshest refresh token we know of: a rotated one from an earlier
 * file in this run if there is one, else the minted original. */
function currentRefreshToken(): string {
  if (existsSync(ROTATED_TOKEN_FILE)) {
    const rotated = readFileSync(ROTATED_TOKEN_FILE, "utf8").trim();
    if (rotated) return rotated;
  }
  return tokens!.refresh_token;
}

export async function openAuthedContext(
  browser: Browser,
  options: BrowserContextOptions & { baseURL?: string } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  // The specs do not pass baseURL; it comes from the same env var
  // playwright.config.ts reads, so local and production resolve alike.
  const api = new URL(apiBase(options.baseURL ?? process.env.E2E_BASE_URL));
  await context.addCookies([
    {
      name: REFRESH_COOKIE_NAME,
      value: currentRefreshToken(),
      domain: api.hostname,
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      secure: api.protocol === "https:",
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  return { context, page };
}

/** Persist the rotated token (read from the cookie jar, since script cannot
 * see an HttpOnly cookie) for the next file, then close. */
export async function closeAuthedContext(context: BrowserContext | undefined, page: Page | undefined) {
  if (context) {
    const rotated = (await context.cookies().catch(() => []))
      .find((cookie) => cookie.name === REFRESH_COOKIE_NAME)?.value;
    if (rotated) {
      mkdirSync(dirname(ROTATED_TOKEN_FILE), { recursive: true });
      writeFileSync(ROTATED_TOKEN_FILE, rotated, "utf8");
    }
  }
  if (page && !page.isClosed()) await page.close();
  await context?.close();
}

/** Assert the session bootstrapped: not bounced to /login. */
export async function expectSignedIn(page: Page) {
  await expect(page).not.toHaveURL(/\/login/);
}
