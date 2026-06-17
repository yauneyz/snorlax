---
title: "Hello, world"
slug: "hello-world"
description: "First post in the starter. Replace me with something interesting."
publishedAt: "2025-01-01"
author: "Starter Team"
tags: ["announcement"]
draft: false
---

# Hello, world

This is the example blog post shipped with the SaaS starter. Delete it, then add your own
`.md` files under `content/blog/`. Each post requires the frontmatter schema defined in
`src/lib/zod/blog-frontmatter.ts`.

## Images

Put images under `content/blog/resources/` and reference them as:

```md
![alt](resources/my-image.png)
```

The markdown renderer rewrites those to `/api/blog/resources/my-image.png` at build time.

## What's in the starter

- Auth (Supabase) with email+password and Google OAuth
- Stripe subscriptions with monthly + yearly pricing
- Transactional email via Resend
- Sentry, PostHog, and GA4 already wired up
- A sitemap, robots.txt, and per-page canonical tags

Happy shipping.
