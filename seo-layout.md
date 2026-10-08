# SEO / GEO layout

How talysman.app is set up to rank in search, and to be cited by LLMs (GEO), for the queries we
care about. It covers what changed, why, what's left, and how to start.

_Last updated 2026-10-07. Supersedes `seo-todo.md`._

---

## 1. Strategy in one paragraph

**One page per search intent, each answering its question in the first paragraph, honestly.**
The homepage does not try to rank for everything. Each query we want ("Cold Turkey alternative",
"website blocker for Linux", "is there a Brick for computer") gets its own URL with a unique
title, a unique H1, and a "short answer" block that answers the question in one quotable
sentence. That sentence is what Google shows in snippets and what an LLM lifts into its answer.
Comparison pages concede what competitors do better, cite the vendor's own docs, and show a
"Last checked" date. Models (and people) trust a page that says "if you want X, use Cold Turkey"
more than one where we win every row.

### Principles every page follows
1. **Answer first.** A panelled "The short answer" block before any pitch. Its first sentence
   restates the query and answers it.
2. **A demonstration.** A beat-by-beat account of the moment the mechanism is felt, readable with
   no video. In production, a real screenshot of the refusal state sits beside it.
3. **An honesty section.** Admin rights beat any blocker. We say so. The claim is that the cheap
   exits are gone, not that there are none.
4. **Accurate competitor claims.** Every competitor fact links to that vendor's own docs. Pages
   that describe other products show "Last checked <Month Year>".
5. **Product facts from code, not memory.** Prices and limits come from `@talysman/product`
   constants (`FREE_BLOCKED_SITE_LIMIT`, `PRO_PRICE_CENTS`, `LIFETIME_PRICE_CENTS`,
   `PRO_TRIAL_DAYS`). Enforcement claims were checked against `native/*` and
   `snorlax-architecture.md`.

---

## 2. Site layout

### URLs
All search pages live at the **site root**: the query is the URL (`/cold-turkey-alternative`).
There are no `/compare/`, `/guides/` or `/use-cases/` folders and no hub index pages. Those three
words survive only as **footer column headings**, which group the pages.

### Navigation and internal links
```
Header:  How it works (/physical-website-blocker) · Compare (/cold-turkey-vs-freedom-vs-focusme) · Pricing · [Get Talysman free]

Homepage
  ├─ "Why It Works" ──────────────► /physical-website-blocker   (mechanism page)
  ├─ 3-path diagram
  │    ├─ Strict lock modes ──────► /cold-turkey-vs-freedom-vs-focusme
  │    └─ Talysman ───────────────► /physical-website-blocker
  ├─ "Coming from" pills ─────────► /cold-turkey-alternative, /freedom-alternative,
  │                                 /focusme-alternative, /brick-for-computer
  └─ FAQ answers ─────────────────► /website-blocker-you-cant-turn-off,
                                    /website-blocker-windows, -mac, -linux

Footer (every marketing page): Compare | Guides | Use cases, listing all 22 search pages,
then Download · Pricing · Blog · About · Privacy · Terms

Every search page: "Keep reading" cards → 3–4 related pages (comparisons cross-link each
other; guides link to at least one comparison; everything links back toward the mechanism)
```

### The 22 search pages

| URL | Group | Primary query / prompts it answers | Status |
|---|---|---|---|
| `/website-blocker-you-cant-turn-off` | Use cases | website blocker you can't turn off; blocker I can't disable impulsively; survives restart | Renamed from `/website-blocker-you-cant-disable`, retitled |
| `/physical-website-blocker` | Guides | physical website blocker; distraction blocker that requires a physical key. **Mechanism page.** | Retitled |
| `/cold-turkey-alternative` | Compare | Cold Turkey alternative; …with an emergency exit; …if I don't want an irreversible lock; Cold Turkey vs Talysman | Retitled, claims corrected, new "emergency exit" section |
| `/brick-for-computer` | Compare | Brick for computer; anything like Brick for Windows/Mac; app like Brick for desktop | Renamed from `/brick-for-desktop`, retitled |
| `/freedom-alternative` | Compare | Freedom alternative; Freedom vs Talysman | Renamed from `/freedom-alternative-for-desktop`, claims corrected |
| `/focusme-alternative` | Compare | FocusMe alternative | **New** |
| `/cold-turkey-vs-freedom-vs-focusme` | Compare | Cold Turkey vs Freedom vs FocusMe for deep work | **New** |
| `/digital-lock-vs-physical-friction` | Compare | digital locks vs physical friction; hardest blocker to bypass impulsively; emergency exit without an override button | **New** |
| `/website-blocker-windows` | Use cases | website blocker Windows; app blocker for focused work on Windows | **New** |
| `/website-blocker-mac` | Use cases | website blocker Mac | **New** |
| `/website-blocker-linux` | Use cases | website blocker for Linux that's hard to bypass | **New** |
| `/app-blocker-pc` | Use cases | app blocker for PC | **New** |
| `/stop-disabling-website-blocker` | Guides | stop disabling website blocker; how can a remote worker stop bypassing their blocker | Renamed from `/how-to-stop-disabling-website-blockers`, retitled |
| `/deep-work-blocker` | Use cases | deep work blocker; best distraction blocker for desktop | **New** |
| `/block-reddit-while-working` | Guides | block Reddit while working; writer who keeps opening Reddit | **New** |
| `/block-youtube-while-working` | Guides | block YouTube while working; programmers who need YouTube for work | Renamed from `/youtube-blocker-for-desktop`, **rewritten** around site rules |
| `/block-social-media-on-computer` | Guides | block social media on computer | **New** |
| `/focus-app-developers` | Use cases | focus app for developers | **New** |
| `/focus-app-writers` | Use cases | focus app for writers | **New** |
| `/focus-app-remote-work` | Use cases | focus app for remote workers; Freedom vs Talysman for a remote worker | **New** |
| `/blocker-for-people-who-bypass-blockers` | Use cases | best website blocker if I keep turning my blocker off | Retitled |
| `/turn-a-usb-drive-into-a-distraction-blocker` | Guides | turn a USB drive into a distraction blocker | Unchanged apart from fixes |

Titles and meta descriptions follow the "first twenty pages" brief exactly where it gave them.
`#20 /research/physical-friction-focus-experiment` was **skipped on purpose**. It needs real data,
and publishing a study without results would be fabrication.

### Redirects
`apps/web/src/lib/content/intent/legacy-redirects.ts` → `next.config.ts` `redirects()`, all
permanent (308):

| Old | New |
|---|---|
| `/brick-for-desktop` | `/brick-for-computer` |
| `/website-blocker-you-cant-disable` | `/website-blocker-you-cant-turn-off` |
| `/freedom-alternative-for-desktop` | `/freedom-alternative` |
| `/how-to-stop-disabling-website-blockers` | `/stop-disabling-website-blocker` |
| `/youtube-blocker-for-desktop` | `/block-youtube-while-working` |

---

## 3. Claims we corrected

| Where | Was | Now |
|---|---|---|
| Homepage diagram | "Every other blocker → Click End session" | Three paths: *Most blockers* (one click) · *Strict lock modes (Cold Turkey, Freedom, FocusMe)* (strong but all-or-nothing, so you set them short or skip them) · *Talysman* (walk to the key) |
| Cold Turkey page | Lock list missing Time Range and Frozen Turkey; "Talysman is a subscription" | Full lock list from Cold Turkey's user guide; notes it has no documented emergency override and no Linux support; pricing row reflects Free / Pro / Lifetime |
| Freedom page | "A software decision inside the app" | Locked Mode can be ended from the dashboard once every 7 days; Windows uninstall prevention exists (cited) |
| Brick page | Implied no emergency option | Brick has 5 emergency unBricks; it's iOS 17+/Android 12+ only (cited) |
| Locked windows (6 pages) | "Nothing ends it early, key included" | Only one of **5 lifetime emergency unlocks per computer** ends it early (`EMERGENCY_LIFETIME_LIMIT`) |
| Lost-key FAQs (5 pages) | "Pair spares" only | Also mentions the 5 keyless emergency unlocks |
| Browser closing (7 places) | "Browsers without the extension are closed" (unconditional) | Qualified with **Strict Mode**, which defaults to *off* (`native/common/src/model.rs`); network-level blocking covers other browsers regardless |
| YouTube page | "Blocking is domain-level; can't allow one video" | Site rules hide the feed, sidebar, recommendations and end screens, and keep search, direct videos and Studio |
| Homepage FAQ | Uninstaller refuses (all platforms) | "On Windows and Linux". macOS has no installer hook (see §5) |
| Pricing FAQ | "Lifetime plan? Not today" | Lifetime exists: a single `LIFETIME_PRICE_CENTS` payment |
| Hard-coded "five sites" (4 places) | Literal | `FREE_BLOCKED_SITE_LIMIT` |

---

## 4. Technical SEO done

- **Sitemap** (`src/app/sitemap.ts`): generated automatically from the page registry. Adds
  `lastModified` from each page's `lastReviewed`, plus `/blog` and blog posts, which were missing.
  32 URLs in total.
- **Indexability:** every sitemap URL was verified against a local production build. Each
  returns 200, has exactly one `<h1>`, a self-referencing canonical, a unique `<title>`, and no
  `noindex`. Page copy is server-rendered (the "short answer" is in the raw HTML).
- **noindex** on `/login`, `/signup`, `/forgot-password` and `/reset-password` via the `(auth)`
  layout. They stay crawlable so the noindex is seen. `/app`, `/account`, `/redeem`, `/api` and
  `/insights` stay disallowed in robots.txt.
- **Structured data** (`src/components/seo/JsonLd.tsx`):
  - `SoftwareApplication` on `/` and `/pricing`, with offers for Free, Pro monthly, Pro yearly and
    Lifetime built from product constants. No ratings.
  - `VideoObject` for the real hero demo on `/` (28s, uploaded 2026-08-10).
  - Every value is something visible on that page.
- **OG / share cards** (`src/lib/og/intentCard.tsx` + `[slug]/opengraph-image.tsx`): each of the
  22 pages gets its own 1200×630 card showing the group, the H1, and the mechanism drawn as
  *End session → Refused: no key plugged in → The key is in another room*.
- **Infographics** (`src/lib/og/intentGraphic.tsx` + `[slug]/graphic.png/route.tsx`): every page
  has a `graphic` drawn by Satori (via `next/og`) and prerendered at build to
  `/<slug>/graphic.png`. It shows the answer at a glance, in one of five forms: an *escape ladder*
  (every way out, and where each one lands), a *comparison*, *site rules* (hidden or still
  works), a *timeline* of a session, or a sequence of *states*. Ladders, comparisons and rules
  name rows of the page's own tables (`fromTable`) instead of restating them, so the picture
  can't drift from the copy. A renamed row fails `intent-pages.test.tsx`. Fonts are the brand's
  WOFF files (`@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`), and marks are drawn
  as SVG because the fonts have no ✕/✓ glyphs.
- **Demo videos** (`apps/motion`, Remotion): every page has a 25–45s motion demo of its main
  point. Its demo section now leads the page, straight after the short answer, at full width with
  the beats written out beneath it. The app on screen is the **real desktop renderer** (`App`,
  the seal, Keys, Blocklists, the blocked-app popup), driven frame by frame with `ServiceState`
  snapshots that `pnpm motion:fixtures` records from the mock service running the real wasm
  engine. The block page is the extension's built `blocked.html`. Terminal and dialog text is
  copied from `native/` (svcctl's guard message, the NSIS refusal, the systemd unit). Sites with
  no capture are drawn as neutral schematics (grey blocks, dashed "hidden by site rule"
  outlines), with no logos or third-party content. Each page also gets a `VideoObject`.
  - `pnpm motion:studio` previews them (the `gallery` composition shows every real-UI state).
  - `pnpm motion:render [slug…]` renders at 2× and downscales to 1080p, the same as the hero. It
    writes `public/media/demos/<slug>.{mp4,webm,jpg}` and `src/lib/content/intent/demo-videos.json`.
  - `pnpm --filter @talysman/motion stills <dir> [secs|poster] [slug…]` produces review stills.
- **Mechanism visible without reading:** demo sections now show the real "insert key to turn off
  focus" screenshot in production instead of collapsing to text only.
- **Tests:**
  - `tests/unit/intent-pages.test.tsx` checks unique slugs, titles, H1s and descriptions; no
    collisions with real routes; that every related link resolves; that every redirect targets a
    live page; that every page is dated; that no page says "every other blocker"; and that JSON-LD
    prices match the constants.
  - `tests/e2e/marketing.spec.ts` checks every sitemap URL for indexability, plus the 308s.

### How to add a page
1. Add `apps/web/src/lib/content/intent/<slug>.tsx`, exporting an `IntentPage`. Copy the closest
   existing page. It needs a `demo` section and a `graphic`.
2. Register it in `intent/index.ts` (order = sitemap and footer order).
3. If it replaces an old URL, add the old slug to `legacy-redirects.ts`.
4. Add `apps/motion/src/demos/<slug>.tsx`, built from the shared moments in `ui/Moments.tsx`
   (`KeyLeaves`, `Refusal`, `Blocked`, `KeyAway`, `PairKey`…). Register it in `demos/index.ts`,
   then run `pnpm motion:render <slug>`.

The template, sitemap, footer, OG card and graphic pick it up automatically. The tests fail until
the page has a rendered video.

---

## 5. Needs your attention (found while verifying claims)

1. **macOS uninstall isn't key-gated.** Windows (NSIS `customUnInstall`) and Linux (dpkg
   `before-remove.sh`) abort removal during focus without a key. On macOS there's no installer
   hook, and `svcctl uninstall` calls `guard_uninstall()` but ignores its result
   (`native/macos/src/bin/svcctl.rs:56`; the Linux svcctl does the same, but the prerm hook covers
   it there). **Resolved 2026-10-07 by qualifying the copy:** every uninstall claim now says
   "on Windows and Linux" and states that macOS has no uninstaller to gate. A svcctl-only Mac
   guard wouldn't make the claim true, since a Mac app is removed by dragging it to the Trash.
2. ~~Pre-existing e2e failure~~ **Fixed:** the pricing assertion checks the yearly price shape
   and "Billed annually" instead of a literal amount. The suite passes against production.
3. **Competitor facts to re-check before promoting** (I verified Cold Turkey, Freedom Locked
   Mode, FocusMe's platform list and Brick against their own sites on 2026-10-07; these are less
   certain):
   - Freedom's full platform list (ChromeOS)
   - App blocking on each competitor
   - Cold Turkey's pricing model ("one-time Pro license")
4. ~~Mobile header wrap~~ **Fixed:** below 420px "Compare" is hidden (it's in the footer) and
   the nav is tightened, so it stays on one row from ~340px up (320px still wraps, legibly).

---

## 6. What remains

### Manual (only you can do these)
- [ ] **Deploy**, then run the curl checks:
  ```
  curl -sI https://talysman.app/                           # 308 → www
  curl -sI https://www.talysman.app/brick-for-desktop      # 308 → /brick-for-computer
  curl -s  https://www.talysman.app/robots.txt
  curl -s  https://www.talysman.app/sitemap.xml | grep -c '<loc>'   # 32
  curl -sI https://www.talysman.app/cold-turkey-alternative | grep -i x-robots   # should be empty
  ```
- [ ] **Google Search Console:** submit `https://www.talysman.app/sitemap.xml`, then use URL
  Inspection → *Request indexing* on the top 8 pages (§7, week 1).
- [ ] **Bing Webmaster Tools:** import from GSC and submit the sitemap. Bing's index feeds ChatGPT
  search and Copilot, so for GEO this matters as much as Google.
- [ ] **Rich Results Test** on `/` and `/pricing`; **opengraph.xyz** on 2–3 comparison pages.
- [ ] **CWV baseline:** run PageSpeed Insights (mobile and desktop) for `/`, `/pricing`,
  `/cold-turkey-alternative` and `/physical-website-blocker`. Record LCP, CLS, INP and TTFB
  below. Check GSC's CWV report in ~4 weeks once field data exists.

**Lab baseline, 2026-10-07** (local Lighthouse 12 against production. The keyless PageSpeed
API was out of quota, so re-run PSI for the official numbers. INP needs field data, so TBT
stands in until GSC has it.)

| Page | Mobile perf | Mobile LCP | CLS | Mobile TBT | TTFB | Desktop LCP |
|---|---|---|---|---|---|---|
| `/` | 99 | 2.0 s | 0 | 50 ms | 20 ms | 0.6 s |
| `/pricing` | 98 | 1.9 s | 0 | 150 ms | 20 ms | 0.5 s |
| `/cold-turkey-alternative` | 98 | 2.3 s | 0 | 90 ms | 20 ms | 0.7 s |
| `/physical-website-blocker` | 99 | 2.2 s | 0 | 50 ms | 20 ms | 0.5 s |

### Engineering follow-ups
- [ ] **Static marketing pages.** Every marketing page renders dynamically because `Header`
  calls `supabase.auth.getUser()` (and middleware does too). If the TTFB baseline is poor, move the
  auth-aware nav into a client island so these pages can be served statically.
  **Not needed for now:** the lab baseline shows a ~20 ms root document and every mobile LCP
  under 2.5 s. Revisit if GSC field data disagrees.
- [x] **Measure which intents convert.** Every download link on a search page is
  `/download?from=<slug>`. `/download` passes `from` on to the installer redirect, which records
  it on `download_clicked` (only when it names a live page). `analytics_landing_funnel`
  (migration 0017) reports, per first-touch landing page, visitors, organic visitors,
  downloads, installs, activation and paid, plus last-touch CTA downloads. The **Landing pages**
  panel on /insights groups it by footer cluster. **Needs `supabase db push` to prod** before
  the deployed summary API can serve it.
- [x] **Demo videos.** Rendered from the real UI by `apps/motion` (see §4). Live-action footage
  (the key on a real kitchen counter) could still replace the floor-plan scene later. The
  `demo.media` shot lists remain as the brief for that.
- [x] **Refusal wording.** Pages, videos and the app tooltip all say "Insert your key to turn off
  the blocker". Some beats and graphic rows still call the button "End session"; the app's button
  is "Turn off".
- [ ] **#20 research page.** Once there's analytics on session completion, write it up from
  real data.
- [ ] Resolve the four items in §5.

---

## 7. Kickoff plan

**Week 0 (deploy day)**
1. Ship and run the curl checks.
2. Submit the sitemap to GSC and Bing.
3. Request indexing, in this order (the brief's publication order):
   - `/website-blocker-you-cant-turn-off`
   - `/physical-website-blocker`
   - `/cold-turkey-alternative`
   - `/brick-for-computer`
   - `/freedom-alternative`
   - `/focusme-alternative`
   - `/website-blocker-windows`
   - `/website-blocker-linux`
4. Run the GEO benchmark (§8) once **before** the pages are indexed. That's the baseline.

**Weeks 1–2: seed the pages where people and models look.** LLM answers lean heavily on Reddit,
YouTube, Hacker News and comparison articles, not just our site.
- Answer existing threads ("blocker I can't turn off", "Cold Turkey alternative",
  "Brick for laptop") on r/productivity, r/getdisciplined, r/ADHD, r/linux and r/nosurf. Disclose
  that you're the maker, answer the question properly, and link the matching page only where it
  genuinely answers it.
- Post `/website-blocker-linux` to Linux communities. It's the least contested query: Cold Turkey
  doesn't run on Linux.
- Show HN with the mechanism, linking `/physical-website-blocker`.
- Record one 60-second demo (key in another room) for YouTube and Shorts. It also becomes the
  `VideoObject` for the mechanism page.

**Weeks 2–4**
- Request indexing for the remaining pages.
- Pitch `/digital-lock-vs-physical-friction` and `/cold-turkey-vs-freedom-vs-focusme` to
  productivity newsletters and "best blockers" listicle authors. Those listicles are what models
  cite for "best X" prompts.

**Every 2 weeks**
- Re-run the GEO benchmark and log the results.
- Check GSC → Performance → Queries for impressions without clicks, and rewrite those titles or
  answers.

**Every quarter**
- Re-check every competitor claim and bump `lastReviewed`. The visible "Last checked" date updates
  with it.

---

## 8. GEO benchmark (fixed prompt set)

Run every prompt in a fresh session on ChatGPT (with search), Claude, Perplexity, Gemini and
Google AI Overviews. For each, record:
- **Mentioned?** Is Talysman named at all?
- **Cited?** Is a talysman.app URL linked?
- **Accurate?** Does it describe the key, the platforms and the price correctly?
- **Competitors named:** which ones appear.

Track it in a sheet with one row per prompt × engine × date.

### Category
| # | Prompt | Target page |
|---|---|---|
| 1 | What is the best distraction blocker for desktop computers? | `/deep-work-blocker` |
| 2 | Which website blockers are hardest to bypass? | `/digital-lock-vs-physical-friction` |
| 3 | What is a good app blocker for focused work on Windows? | `/app-blocker-pc`, `/website-blocker-windows` |
| 4 | What's the best website blocker for Mac? | `/website-blocker-mac` |
| 5 | What website blocker works on Linux and is difficult to bypass? | `/website-blocker-linux` |
| 6 | What's the best focus app for deep work? | `/deep-work-blocker` |
| 7 | Which desktop blocker is hardest to bypass impulsively? | `/digital-lock-vs-physical-friction` |
| 8 | What's a good app blocker for PC gaming distractions? | `/app-blocker-pc` |
| 9 | What's the best way to block social media on my computer? | `/block-social-media-on-computer` |
| 10 | Best website blocker for people with ADHD on desktop? | `/blocker-for-people-who-bypass-blockers` |

### Constraint
| # | Prompt | Target page |
|---|---|---|
| 11 | Is there a website blocker I can't disable impulsively? | `/website-blocker-you-cant-turn-off` |
| 12 | Is there a blocker that needs a physical object to turn off? | `/physical-website-blocker` |
| 13 | Is there a distraction blocker that requires a physical key? | `/physical-website-blocker` |
| 14 | Which blocker gives me an emergency exit without putting an override button on the computer? | `/digital-lock-vs-physical-friction` |
| 15 | Is there a blocker that survives restarting the computer? | `/website-blocker-you-cant-turn-off` |
| 16 | What is the best website blocker if I keep turning my blocker off? | `/blocker-for-people-who-bypass-blockers` |
| 17 | Can I use a USB drive as a key to unlock my website blocker? | `/turn-a-usb-drive-into-a-distraction-blocker` |
| 18 | Is there a blocker that can't be uninstalled during a focus session? | `/website-blocker-you-cant-turn-off` |
| 19 | How do I stop myself from disabling my website blocker? | `/stop-disabling-website-blocker` |
| 20 | Is there a website blocker that blocks every browser, not just Chrome? | `/website-blocker-windows` |

### Competitor
| # | Prompt | Target page |
|---|---|---|
| 21 | What is a good alternative to Cold Turkey if I don't want a completely irreversible lock? | `/cold-turkey-alternative` |
| 22 | What is a Cold Turkey alternative with an emergency exit? | `/cold-turkey-alternative` |
| 23 | Cold Turkey vs Talysman for deep work? | `/cold-turkey-alternative` |
| 24 | Cold Turkey vs Freedom vs FocusMe: which is best for deep work? | `/cold-turkey-vs-freedom-vs-focusme` |
| 25 | Freedom vs Talysman for a remote worker? | `/freedom-alternative`, `/focus-app-remote-work` |
| 26 | What's a good Freedom alternative for desktop? | `/freedom-alternative` |
| 27 | What's a FocusMe alternative? | `/focusme-alternative` |
| 28 | Is there something like Brick for a laptop or desktop? | `/brick-for-computer` |
| 29 | Is there anything like Brick for a Windows or Mac computer? | `/brick-for-computer` |
| 30 | Is there an app like Brick but for desktop? | `/brick-for-computer` |

### Persona / use case
| # | Prompt | Target page |
|---|---|---|
| 31 | Best distraction blocker for programmers who need YouTube for work but get distracted by it? | `/focus-app-developers`, `/block-youtube-while-working` |
| 32 | Best focus software for a writer who keeps opening Reddit? | `/focus-app-writers`, `/block-reddit-while-working` |
| 33 | How can a remote worker stop bypassing their own website blocker? | `/focus-app-remote-work`, `/stop-disabling-website-blocker` |
| 34 | How do I block YouTube while working but still watch tutorials? | `/block-youtube-while-working` |
| 35 | How do I block Reddit while working? | `/block-reddit-while-working` |
| 36 | How can I hide the Instagram or LinkedIn feed but keep messages on desktop? | `/block-social-media-on-computer` |
| 37 | Focus app for developers that won't break my dev tools? | `/focus-app-developers` |
| 38 | How do I set up a deep work block that I can't abandon on impulse? | `/deep-work-blocker` |
| 39 | How do I block Discord and Steam while studying on my PC? | `/app-blocker-pc` |
| 40 | How can I create a boundary between work and distraction when working from home? | `/focus-app-remote-work` |

**What "winning" looks like at 90 days:** Talysman is named in ≥50% of the constraint and
Brick-for-desktop prompts on at least two engines, and cited with a talysman.app link in ≥25%.
Category prompts (1–10) are the hardest and the last to move.
