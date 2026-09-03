import { test, expect } from "@playwright/test";

import { apiBase } from "./auth";

/**
 * The login page, as served. Audit H1 (2026-09-03): the page used to open
 * in OTP mode while production could not send email, so it told everyone a
 * code was on its way. Now password sign-in is the first thing on screen
 * and the code flow is offered only when /auth/login-options says the
 * server can deliver. No credentials are used; nothing is submitted with
 * a real account.
 */

test("password sign-in is the default form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send login code" })).toHaveCount(0);
});

test("the code option is offered exactly when the server can deliver it", async ({ page, request, baseURL }) => {
  const options = await (await request.get(`${apiBase(baseURL)}/api/v1/auth/login-options`)).json();
  await page.goto("/login");
  await expect(page.getByLabel("Password")).toBeVisible();

  const codeLink = page.getByRole("button", { name: "Sign in with a code instead" });
  if (options.otp_email_login) {
    await expect(codeLink).toBeVisible();
  } else {
    // Production without email delivery: the page must not even show it.
    await expect(codeLink).toHaveCount(0);
  }
});

test("the server never claims a code was sent when it cannot send one", async ({ request, baseURL }) => {
  const options = await (await request.get(`${apiBase(baseURL)}/api/v1/auth/login-options`)).json();
  const response = await request.post(`${apiBase(baseURL)}/api/v1/auth/otp-request`, {
    data: { email: "e2e-nobody@example.com" },
  });
  if (options.otp_email_login) {
    expect(response.status()).toBe(200);
  } else {
    expect(response.status()).toBe(503);
    expect((await response.json()).detail).toContain("password");
  }
});
