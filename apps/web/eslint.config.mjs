import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    // Flat config has no implicit ignores, so build output must be excluded
    // explicitly or ESLint walks all of .next/.
    ignores: [
      "**/node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Match the root config: `_`-prefixed names are intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // The secret-key Supabase client must never be imported client-side.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/supabase/admin", "**/lib/supabase/admin"],
              message:
                "Service-role Supabase client is server-only. Import only from server modules (route handlers, server actions, RSC).",
            },
          ],
        },
      ],
    },
  },
  {
    // Allow the admin import inside server-only files.
    files: [
      "src/app/api/**/*.ts",
      "src/server/**/*.ts",
      "src/lib/auth/require-bearer-user.ts",
      "src/lib/stripe/**/*.ts",
      "src/lib/comp/redeem.ts",
      "src/lib/supabase/admin.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
