import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// RTL's automatic cleanup relies on a global `afterEach` being registered
// by the test framework -- this project runs vitest without `globals: true`
// (test files import describe/it/expect explicitly instead), so it must be
// wired up explicitly here or DOM nodes accumulate across tests in the same
// file.
afterEach(cleanup);

// jsdom doesn't implement these -- Radix UI's Select uses them for pointer
// interactions, which otherwise throws "not a function" mid-test.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
