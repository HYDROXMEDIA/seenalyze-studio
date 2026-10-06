import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "release/**", "vendor/**", "node_modules/**", ".multistream-check.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/main/**/*.{ts,mjs}", "src/preload/**/*.ts", "scripts/**/*.mjs", "*.ts", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // The screen-recording windows are plain browser modules.
    files: ["src/renderer/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
