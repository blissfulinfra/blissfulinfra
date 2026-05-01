import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Layer 3 integration tests (real Docker) live under integration/ and run
    // separately via `npm run test:integration` — exclude from default `npm test`.
    exclude: ["src/**/__tests__/integration/**", "node_modules/**", "dist/**"],
    environment: "node",
    testTimeout: 5_000,
  },
});
