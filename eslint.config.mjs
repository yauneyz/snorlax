import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  {
    // apps/web carries its own Next-specific flat config; the root run skips it
    // and `pnpm lint` delegates there separately.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.pnpm/**",
      "**/.pnpm-store/**",
      "native/**/target/**",
      "apps/web/**",
      "apps/extension/dist/**",
      "apps/desktop/resources/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2023 },
      parserOptions: {
        // Resolves each file to its nearest tsconfig.json. `allowDefaultProject`
        // covers the few loose files that no tsconfig includes.
        projectService: {
          allowDefaultProject: [
            "vitest.config.ts",
            "scripts/*.ts",
            "apps/desktop/electron.vite.config.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",

      // The `no-unsafe-*` family fires on every use of a deliberate `any` seam
      // (the untyped Supabase table client, service mocks, webextension globals).
      // Those boundaries are intentional, so the rules only produce noise here.
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      // The service layer is an async seam by contract (`ServiceConnection`,
      // the installer), so implementations are legitimately `async` without
      // awaiting anything today.
      "@typescript-eslint/require-await": "off",

      // Async JSX event handlers (`onClick={async () => ...}`) are idiomatic;
      // keep the rule for the cases that actually drop errors.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Renderer and preload code runs against the DOM.
    files: ["apps/desktop/src/renderer/**", "apps/desktop/src/preload/**", "apps/extension/**"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    // Plain JS build/release scripts and the extension bundle have no types.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
