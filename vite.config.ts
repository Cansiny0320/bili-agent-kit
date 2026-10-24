import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@bili-agent-kit/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  lint: { options: { typeAware: true, typeCheck: true }, ignorePatterns: ["**/dist/**"] },
  fmt: { ignorePatterns: ["**/dist/**", "pnpm-lock.yaml"] },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 15000 },
});
