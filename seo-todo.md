# High-intent search pages — status

Nine landing pages, one per search intent, live at the site root. Text-only: every page carries a
written demonstration, and the media slots beside them are reserved but not filled.

## Done

### The pages

All nine build, render, and 404 correctly for unknown slugs.

| URL | Intent it answers | Shape |
| --- | --- | --- |
| `/physical-website-blocker` | "physical website blocker" | Category page — defines the term, then a lock-type comparison |
| `/website-blocker-you-cant-disable` | "website blocker you can't disable" | Every route out, and what happens to each |
| `/blocker-for-people-who-bypass-blockers` | "best blocker for people who bypass blockers" | Recognition-led; "your usual move" table |
| `/youtube-blocker-for-desktop` | "youtube blocker for desktop" | Practical — instructions first |
| `/brick-for-desktop` | "brick for desktop" | Comparison: phone NFC tag vs desktop USB key |
| `/cold-turkey-alternative` | "cold turkey alternative with a physical key" | Comparison: locks you satisfy vs a key you fetch |
| `/freedom-alternative-for-desktop` | "freedom alternative for desktop" | Comparison: breadth vs a physical unlock |
| `/how-to-stop-disabling-website-blockers` | "how to stop disabling website blockers" | Informational how-to, five tactics, four of them free |
| `/turn-a-usb-drive-into-a-distraction-blocker` | "turn a USB drive into a distraction blocker" | DIY-flavoured how-to |

Every page follows the same discipline:

- **The intent is answered before anything is sold.** A panelled "The short answer" block sits above
  every section. Someone who bounces after ten seconds still leaves with the answer.
- **Every page carries a demonstration.** A beat-by-beat account of the moment the mechanism is
  felt — the refusal dialog, the drive in the other room, the walk you don't take. Written so it
  works with the video muted, because for now there is no video.
- **Every page carries an honesty section.** Administrator rights beat any blocker; the claim is
  that the cheap exits are gone, not that there are none. Comparison pages concede what the
  competitor does better before comparing.

### Implementation

- `apps/web/src/lib/content/intent/` — one file per page plus `types.ts` and a registry in
  `index.ts`. Content is structured blocks (`prose`, `demo`, `table`, `steps`, `cards`, `honesty`,
  `faq`), not hand-written markup, so all nine share one template.
- `apps/web/src/app/(marketing)/[slug]/page.tsx` — the template. Root-level dynamic segment;
  static routes (`/pricing`, `/download`, `/login`, `/blog`) still win, and `dynamicParams = false`
  plus an explicit `notFound()` means anything not in the registry 404s.
- `apps/web/src/app/globals.css` — new "High-intent search pages" section. Reuses the landing
  page's `.section`, `.steps`, `.outcomes`, `.faq` and `.cta-band` so these don't look like a
  different site. New: the answer panel, the demo timeline (`.beats`), comparison tables
  (`.compare`, horizontally scrollable), the honesty note, and the related-page cards.
- `apps/web/src/app/sitemap.ts` — all nine added at priority 0.7.
- Media slots use the existing `MediaPlaceholder` and respect `showMediaPlaceholders`, so
  production renders the demo as beats at a reading measure with no empty box beside them.
- `pnpm typecheck`, `pnpm lint` and `next build` all pass. All nine prerender via
  `generateStaticParams` and are served dynamically because the marketing layout reads auth
  cookies — the header stays auth-aware.

## Remaining

### Before publishing — do these

1. **Verify the competitor claims.** Three pages describe other products. Claims were kept at the
   mechanism level for exactly this reason, but check them against each vendor's current site and
   adjust if anything has moved:
   - `/brick-for-desktop` — "a physical NFC tag you tap with your phone", "buy the tag". Check
     whether Brick now ships a desktop app; the comparison table's first row assumes it doesn't.
   - `/cold-turkey-alternative` — "wait out a timer, sit through a restart, retype a long string,
     enter a password you chose". Also check the line conceding that a one-time license may matter
     more than a physical lock.
   - `/freedom-alternative-for-desktop` — "phone, tablet and computer from one account", Locked
     Mode as a software decision.

   Each has a footnote saying it isn't affiliated and compares mechanisms rather than feature
   lists. Keep those.

2. **Check the product claims against shipped behaviour.** The pages state, repeatedly: the service
   restarts when killed, sessions survive reboot, the uninstaller refuses mid-session without a
   key, browsers without the extension get closed during a locked session, blocking is
   domain-level, pairing normally writes nothing to the drive. All are taken from the homepage
   copy. If any is aspirational rather than shipped, it needs fixing in nine places — grep the
   `intent/` directory.

3. **Finish the responsive pass.** I was mid-verification when this was written. Specifically:
   comparison tables have `min-width: 560px` inside an `overflow-x: auto` box — confirm the page
   body itself never scrolls sideways at 375px, and check the demo timeline and related-page cards
   at that width.

### Media (the part you said you'd handle)

Each page's demo block has a `media` field with a ratio, a kind, a label and a shot list. Nine
slots, all 16:9 video. They're written as directions, e.g.:

> Screen recording. Session running → user clicks End session → "Insert your key to end early"
> with the red key indicator → cut to the USB drive on a shelf in the next room → cut back to the
> editor.

Several are the same footage cut differently, so one shoot probably covers most of them. The
`/cold-turkey-alternative` slot is the odd one out — it wants a side-by-side.

When the files exist: swap `MediaPlaceholder` for the real element in the `demo` case of
`[slug]/page.tsx`, and drop the `showMediaPlaceholders` branch there (and the
`.intent-demo__grid--flat` rule it drives).

### Discovery — worth deciding on

Nothing in the site chrome links to these pages. They cross-link to each other via "Keep reading",
and the sitemap lists them, which is enough for indexing but not for a visitor who lands on the
homepage. Options, roughly in order of how much I'd recommend them:

- A footer column ("Blocking guides", four or five links). Cheapest, and it gives every page a
  site-wide inbound link.
- Links from the homepage FAQ answers into the matching page — the YouTube answer into
  `/youtube-blocker-for-desktop`, the "can I just quit the app" answer into
  `/website-blocker-you-cant-disable`.
- An index page at `/guides`. Only worth it if the set grows past nine.

### Later

- **Structured data.** Deliberately skipped. `FAQPage` markup no longer produces rich results for
  sites like this, and the answers are JSX, so emitting valid JSON-LD would mean duplicating the
  copy as plain text. Reconsider if the FAQ answers ever move to a plain-text source.
- **Open Graph images.** All nine currently fall back to `/og-default.png`. Per-page images would
  help the comparison pages most, since those get shared into arguments about blockers.
- **Measurement.** These pages only justify themselves if you can see which intents convert. Worth
  tagging the download CTA with the source page before you spend more effort on the set.
- **The rest of the keyword list.** The template takes new pages cheaply now: add a file to
  `intent/`, register it in `index.ts`, done. Obvious next candidates — "app blocker for Windows",
  "block Reddit on desktop", "focus app that locks you out", "SelfControl alternative for Windows".
