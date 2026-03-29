import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Workspace-specific ignores (avoid linting Python virtualenvs / generated assets):
    ".venv/**",
    "backend/venv/**",
    "backend/__pycache__/**",
    "backend/chroma_db/**",
    "backend/uploads/**",
  ]),
]);

export default eslintConfig;
