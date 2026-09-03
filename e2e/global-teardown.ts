import { request, type FullConfig } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";

import { apiBase, tokens } from "./auth";

/** Revoke the e2e session once the whole run is over -- the same call the
 * Sign out button makes -- so it does not outlive the run. Done here, not
 * per file, because the files hand the rotating token on to each other. */
export default async function globalTeardown(config: FullConfig) {
  const file = "playwright/.auth/refresh-token";
  if (!existsSync(file)) return;
  const refreshToken = readFileSync(file, "utf8").trim();
  rmSync(file, { force: true });
  if (!refreshToken) return;

  const baseURL = config.projects[0]?.use.baseURL;
  const api = await request.newContext();
  try {
    // /auth/logout is itself an authenticated call: it needs the access JWT
    // as well as the refresh token it is revoking.
    await api.post(`${apiBase(baseURL)}/api/v1/auth/logout`, {
      headers: { Authorization: `Bearer ${tokens?.access_token ?? ""}` },
      data: { refresh_token: refreshToken },
    });
  } finally {
    await api.dispose();
  }
}
