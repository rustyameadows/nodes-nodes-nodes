import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "dist/**",
      "build/**",
      "out/**",
      "scaffoldapp/**",
      ".next/**",
      "node_modules/**",
      "tsup.config.bundled_*.mjs",
    ],
  }
);
