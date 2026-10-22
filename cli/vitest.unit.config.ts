// Pure tests only (no backend): npm run test:unit.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit.test.ts", "tests/**/*.unit.test.ts"],
  },
});
