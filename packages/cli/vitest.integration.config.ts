import { defineConfig } from "vitest/config";

// Integration tests — slow, require Docker. Each test gets a unique
// BLISSFUL_HOME via mkdtemp so they don't pollute the user's real registry.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 300_000,        // 5 min — Docker pulls + builds are slow
    hookTimeout: 300_000,
    pool: "forks",                // each test file in its own process
    poolOptions: { forks: { singleFork: true } }, // one at a time, avoid Docker concurrency thrash
  },
});
