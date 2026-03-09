import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/electron/main.ts",
    preload: "src/electron/preload.ts",
    worker: "src/electron/worker.ts",
  },
  outDir: "dist/electron",
  clean: !process.argv.includes("--watch"),
  format: ["cjs"],
  platform: "node",
  sourcemap: true,
  external: ["electron", "better-sqlite3"],
  target: "node20",
  splitting: false,
  treeshake: true,
  outExtension() {
    return {
      js: ".cjs",
    };
  },
});
