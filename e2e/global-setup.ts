import { rmSync } from "node:fs";

/** A rotated token left by a previous run is revoked by that run's teardown;
 * make sure no file is around to be mistaken for a live one. */
export default function globalSetup() {
  rmSync("playwright/.auth/refresh-token", { force: true });
}
