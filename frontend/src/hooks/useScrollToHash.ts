import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Scrolls `#id` into view when the URL's hash names it and `ready` is true.
 *
 * React Router does not scroll to a hash, so the clickable counts on the
 * Talent Pool and Joining pages (all links ending in `#register` / `#list`)
 * rely on this. Keyed on `location.key`, so clicking the same count twice
 * (same URL, new navigation) scrolls again.
 *
 * `ready` must mean "the list has its rows", not just "the list is
 * rendered": on a fresh page load the list arrives after everything above
 * it, and scrolling to it while its table is still empty left the page too
 * short to bring it to the top -- so a pasted `...#register` link opened at
 * the top of the page (fixed 2026-10-31). An in-page click keeps the
 * previous rows on screen while the new ones load, so it stays ready and
 * scrolls at once.
 */
export function useScrollToHash(id: string, ready: boolean): void {
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== `#${id}` || !ready) return;
    const target = document.getElementById(id);
    if (!target || typeof target.scrollIntoView !== "function") return;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, [id, location.key, location.hash, ready]);
}
