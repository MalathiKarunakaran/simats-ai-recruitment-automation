/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Vitest's default is 5s, which this suite genuinely outgrew: a full run
    // on a fast dev machine failed 5 EligibilityRulesPage tests purely on
    // timeouts, then passed 694/694 on the identical commit, and those files
    // pass in isolation every time. The tests are not slow individually --
    // they are starved of CPU when ~65 jsdom files run in parallel, and jsdom
    // environment setup alone accounts for a large share of wall time.
    //
    // A suite whose red runs cannot be trusted is worse than a slower one, and
    // CI runners have fewer cores than this machine, so the ceiling is raised
    // here (not just in CI) rather than left to flake. This does NOT slow down
    // passing tests -- it only changes how long a genuinely hung one waits
    // before failing. Individual tests that need longer still override it
    // locally (e.g. EligibilityRulesPage's own `}, 10000)` cases).
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
