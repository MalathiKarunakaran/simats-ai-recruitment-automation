import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Shared session handling for the authenticated specs.
 *
 * The login page is OTP-first, so a browser cannot log in without a mailbox.
 * `scripts/e2e_mint_tokens.py` issues a real token pair instead; the specs
 * read it from E2E_TOKENS. The refresh token goes into localStorage exactly
 * where AuthContext looks for one, the access token is used for fixture
 * discovery only.
 *
 * REFRESH TOKENS ROTATE. Every bootstrap consumes the stored token and
 * writes a new one; the old one is revoked. That has two consequences this
 * module exists to handle:
 *
 *  - Within a file, tests must share ONE browser context (a fresh context
 *    per test would replay the original, already-revoked token on test two).
 *  - Across files, the rotated token must outlive the context. It is
 *    persisted to `playwright/.auth/refresh-token` (gitignored) when a
 *    context closes and preferred over E2E_TOKENS when the next one opens.
 *    This only works with `--workers=1`, which is how these are run.
 *
 * Without E2E_TOKENS, `skipUnlessAuthed` skips the file rather than failing.
 */

export const REFRESH_TOKEN_STORAGE_KEY = "simats_refresh_token";
const ROTATED_TOKEN_FILE = "playwright/.auth/refresh-token";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  email: string;
  role: string;
}

export const tokens: Tokens | null = process.env.E2E_TOKENS ? JSON.parse(process.env.E2E_TOKENS) : null;

export function apiBase(baseURL: string | undefined): string {
  return (
    process.env.E2E_API_URL ??
    (baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1")
      ? "http://127.0.0.1:8000"
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
  options: BrowserContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  // Runs before any page script on every navigation, so the very first
  // render already finds a session to bootstrap from.
  await context.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    [REFRESH_TOKEN_STORAGE_KEY, currentRefreshToken()],
  );
  const page = await context.newPage();
  return { context, page };
}

/** Persist the rotated token for the next file, then close. */
export async function closeAuthedContext(context: BrowserContext | undefined, page: Page | undefined) {
  if (page && !page.isClosed()) {
    const rotated = await page.evaluate((key) => localStorage.getItem(key), REFRESH_TOKEN_STORAGE_KEY).catch(() => null);
    if (rotated) {
      mkdirSync(dirname(ROTATED_TOKEN_FILE), { recursive: true });
      writeFileSync(ROTATED_TOKEN_FILE, rotated, "utf8");
    }
  }
  await context?.close();
}

/** Assert the session bootstrapped: not bounced to /login. */
export async function expectSignedIn(page: Page) {
  await expect(page).not.toHaveURL(/\/login/);
}
