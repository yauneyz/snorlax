// Populate minimal env for modules that read from process.env at import time.
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_NAME ??= "Test App";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??= "pk_test_xxx";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.STRIPE_SECRET_KEY ??= "sk_test_xxx";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_xxx";
process.env.STRIPE_PRICE_MONTHLY ??= "price_monthly";
process.env.STRIPE_PRICE_YEARLY ??= "price_yearly";
process.env.RESEND_API_KEY ??= "re_test_xxx";
process.env.RESEND_FROM ??= "Test <test@example.com>";
process.env.APP_ENVIRONMENT ??= "development";
process.env.OPENAI_API_KEY ??= "sk_test_xxx";
process.env.TOKEN_ENCRYPTION_KEY ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.OAUTH_STATE_SECRET ??= "test-oauth-state-secret-at-least-32-chars";
