import pkg from "@eslint/eslintrc";

const { FlatCompat } = pkg;
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
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
      "src/lib/supabase/admin.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
];
