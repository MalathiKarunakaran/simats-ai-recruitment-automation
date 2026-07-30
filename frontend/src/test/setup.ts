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

// jsdom has no ResizeObserver -- Recharts' ResponsiveContainer requires one
// to measure its container, and jsdom's getBoundingClientRect() always
// reports 0x0 (no real layout engine), which would otherwise leave
// ResponsiveContainer permanently convinced its container has no size and
// render nothing. This stub reports a fixed, non-zero size synchronously
// from `observe()` so chart components render real content in tests (same
// spirit as the pointer-capture polyfills above -- just enough behavior for
// the library under test to proceed, not a real implementation).
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const rect = { width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON() {} };
      this.callback(
        [{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}
    disconnect() {}
  };
}
