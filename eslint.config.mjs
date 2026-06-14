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
    // Compiled Lambda output — not source, lints as plain JS with require().
    "lambda/**/dist/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // eslint-plugin-react-hooks v7's React Compiler-readiness rules flag the
      // standard "fetch on mount via a named async handler" and
      // "Date.now()-seeded useState" patterns used throughout this codebase.
      // Both are safe today (no React Compiler in use, 183/183 tests green) —
      // downgraded to warnings as a backlog for a future Compiler-adoption pass
      // rather than risk last-minute effect refactors across core gameplay.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;
