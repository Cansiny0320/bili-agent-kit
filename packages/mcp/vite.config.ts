import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: { entry: ["src/main.ts", "src/index.ts"], dts: true, format: ["esm"], sourcemap: true },
});
