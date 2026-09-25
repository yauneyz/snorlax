# Talysman for Android + Profiles/Overrides/Pools/Streaks — Implementation Spec

> **Status:** Spec v1, 2026-09-24. Written so that an engineer new to the repo can implement every
> phase without further input. Anything marked **[DEFAULT — confirm]** is a decision this spec
> made on the product owner's behalf; everything else was decided explicitly (see §1).
>
> Saved in the repo as `android-and-overrides-spec.md`.

---

## 0. Context

Talysman today is a desktop distraction blocker: an Electron UI (`apps/desktop`) remote-controls a
privileged Rust daemon (`native/{linux,windows,macos}` + `native/common`) that enforces a blocking
policy and only lets focus be disabled when a paired **USB key** is physically present. A browser
extension (`apps/extension`) does hostname blocking and *soft blocks* — declarative, per-site
feature hiding (e.g. hide YouTube's home feed but keep search) driven by the site catalog in
`packages/shared/src/sites/`. `apps/android` currently holds only **Talysman Insights**, an
internal analytics app.

We are building **Talysman for Android** — a real, user-facing blocker — which is conceptually a
port of the desktop app with an **NFC tag or QR code** in place of the USB key. At the same time we
are adding a set of new features to **both** platforms:

- many **simultaneously active profiles**, each owning its own full config, plus profile duplication;
- **override pools** (ScreenZen-style: N keyless unlocks/day × M minutes each, shared by a group of apps/sites, with optional friction delay);
- three **override paths** (everything off / subset off / everything off for N minutes);
- **5 lifetime emergency unlocks** (Brick-style);
- a visible **streak** of days without disabling or relaxing the blocker;
- richer **scheduling** (per-profile windows, "on at X"/"off at X", one-time future on/off events);
- on Android: app **blacklist/whitelist**, and **accessibility-based soft blocks** of in-app short-form content (YouTube Shorts, Instagram Reels, …) while leaving library/messaging usable.

The hard requirement is **no duplicated logic**: today policy/schedule/restrictiveness logic is
hand-duplicated between TS (`packages/core`, `packages/shared`) and Rust, and schedule evaluation
is copy-pasted three times (`native/{linux,windows,macos}/src/schedule.rs`). This project extracts
one platform-free Rust **engine** crate used by the desktop daemons natively, by Android via
**uniffi**, and by TS via generated types + a wasm build.

---

## 1. Decision log (every question asked, with the answer)

| # | Question | Answer |
|---|---|---|
| 1 | Where does the shared "brain" live? | **Rust core + uniffi.** New platform-free crate; desktop daemons link it; Android via uniffi Kotlin bindings; TS types generated from Rust. |
| 2 | Android UI tech? | **Native Jetpack Compose** (like Insights). UI screens written twice (React + Compose); all logic shared via the engine. |
| 3 | Multiple profiles at once? | **Many simultaneously active — on desktop too.** "A great idea so we can turn certain features on/off at various points of the day." Enforced result = union, most restrictive wins. |
| 4 | Browser soft blocking on Android (Chrome has no extensions)? | **Soft (feed) filtering only in Firefox for Android via our existing extension.** Chrome gets hard blocking of sites only ("we won't be able to have great soft-blocking on Chrome"). Accessibility is used for URL reading/hard blocking in Chrome. |
| 5 | Which override paths need the key? | **Pool unlocks are keyless; override paths (1) full off, (2) partial off, (3) timed all-off require the key or burn an emergency unlock.** |
| 6 | What breaks the streak? | **Full/partial off (incl. timed all-off), relaxing config, emergency unlock.** Pool unlocks do **not** break it. |
| 7 | Where are emergency unlocks + streak tracked? | **Local now, data designed to sync to the account later.** |
| 8 | How is scheduling an "off" gated? | **Key required to create** (it's a relaxation). Once created it fires without the key. |
| 9 | Android distribution & tamper resistance? | **Sideload first, with an eye toward the Play Store.** |
| 10 | Account/paywall on Android? | **Same Pro entitlement** (Supabase sign-in, `GET /api/desktop/entitlement`, `packages/product` limits). **Plus: the sideloaded build automatically gets free Pro.** |
| 11 | Pool membership? | **An item belongs to at most one pool per profile; pools contain apps and sites.** |
| 12 | Delivery phasing? | **Engine first:** (1) engine crate + new model + desktop daemon migration, (2) desktop UI, (3) Android app, (4) Android soft blocks. |
| 13 | With many active profiles, what do overrides (1)/(2) act on? | **(1) = all profiles off. (2) = pick specific apps/sites to exempt until "Re-enable all";** turning one whole profile off is also a (2)-style key-gated action. |
| 14 | Keys across platforms? | **Separate per platform.** Desktop keeps USB only; Android pairs NFC tags / QR codes. |
| 15 | Friction before a pool unlock? | **Configurable delay per pool** (countdown/breathing, like ScreenZen's "exercises before opening your apps" screen). Popup shows streak + unlocks left. |
| 16 | Android in-app soft blocks for v1? | **YouTube Shorts; Instagram Reels/Explore; Facebook reels/feed, Snapchat Spotlight/Discover, Reddit home feed.** TikTok is not soft-blocked in v1 (hard block only). |
| 17 | After override (1), do scheduled "on" events still fire? | **Yes — schedules still fire** and re-enable their profile. "Stays off until re-enabled" = manual *or* scheduled re-enable. |
| 18 | Emergency unlocks on desktop? Locked windows? | **Desktop gets 5 too** (per device for now). **Locked windows stay**: the key can't end them, an emergency unlock can. |
| 19 | Desktop pool-unlock UX? | **Blocked page + app popup.** Extension `blocked.html` shows streak/unlocks left/unlock button (via native messaging → daemon); when a blocked desktop app is killed, Electron shows the same popup. |
| 20 | AI mode on Android? | **No AI mode on Android yet.** (Desktop keeps it.) |
| 21 | Inspiration screenshot | `inspiration_screenshots/screenzen.png` is actually ScreenZen's *breathing/friction* screen, not the unlock popup. This informed the friction feature. **Action for product owner:** drop in a screenshot of the actual ScreenZen unlock popup if the layout in §3.10 isn't what you want. |

### 1.1 Follow-up decisions (asked after the first draft)
| # | Question | Answer |
|---|---|---|
| 22 | What does spending an emergency unlock do? | **Brick-style: it turns everything off** — always performs override (1) "all off until re-enabled", *including* profiles in locked windows. It is **not** a general key substitute: it cannot authorize relaxing config edits, partial off (2), or timed off (3). |
| 23 | Do keyless pool unlocks work inside a locked window? | **Yes, pools still work.** Locked windows constrain key overrides, not the pre-committed pool budget. To have zero escape, don't put the item in a pool. |
| 24 | Android Chrome (no extension): a site with only a soft rule? | **Route-level only.** Classify the URL with the site catalog's routes; if the page's own feature resolves to `block`, block that page (block screen + back). Other pages (e.g. `/watch`) load normally with no element hiding. |
| 25 | Free tier for new features? | **All free.** Pools, one-shots, overrides, emergency unlocks, streaks, and schedules add no new limits; only existing limits apply (`FREE_PROFILE_LIMIT = 1` still makes multiple profiles — and therefore multiple *simultaneous* profiles — Pro). Sideload = Pro. |

### 1.2 Defaults chosen by this spec **[DEFAULT — confirm]**
1. *(superseded by #22)*
2. *(confirmed by #23)*
3. *(superseded by #24)*
4. **Unsupported browsers on Android are blocked** while any profile with web rules is active (setting, default on), mirroring the desktop browser watchdog.
5. **Whitelisted + soft rule = soft.** (The spec'd cases were: hard + soft = hard; not-in-whitelist + soft = soft. Allow-listed + soft rule is treated as soft since the user configured the soft rule deliberately.)
6. **App whitelist mode is Android-only in v1.** Desktop app blocking stays blacklist-only (whitelisting desktop processes would kill system processes); desktop *web* keeps both modes.
7. **A profile cannot be turned on unless at least one key is paired** on that device (same as today's `NO_PAIRED_KEY`).
8. *(superseded by #25)*
9. **Streak day boundary = local midnight;** streak counter = whole local days since the last breaking event (0 on the day of a break); counting starts the first day a profile is ever turned on. Best streak is also tracked.
10. **Timed override presets:** 10 min, 30 min, 1 h, 2 h, custom (1–720 min).
11. **Pool defaults:** 3 unlocks/day, 10 min each, friction off. Friction options: none, countdown 5–60 s, breathing 5–60 s.
13. **Pairing a new key while any profile is active requires an existing paired key.** Closes an existing desktop loophole (pairing is currently ungated) that would be trivial on Android (any QR code). Lost-key recovery = emergency unlock (everything off) → pair new key → re-enable.
12. **Multiple AI judges (desktop):** each layer's `judge` action is judged with that layer's own `JudgePolicy`; the final decision is the most restrictive across layers.

---

## 2. Glossary

- **Engine** — new Rust crate `talysman_engine` (`native/engine`). Pure logic; no IO, clock, or randomness of its own.
- **Profile** — named, colored bundle of *all* blocking config (§3.1). Several can be active at once.
- **Layer** — the enforceable projection of one active profile's config. Effective policy = list of layers.
- **Item** — something that can be blocked: a domain, an app (`AppRef`), or a catalog entry (site/app with soft rules).
- **Hard block** — item fully unusable (page redirected to blocked page / app sent home with overlay).
- **Soft block** — item usable but specific *features* hidden/neutered (catalog-driven).
- **Key** — physical authorization token: USB drive (desktop) or NFC tag / QR code (Android).
- **Key-gated** — requires key verification at the moment of the action. (The only keyless escape is the emergency unlock, which always means "everything off".)
- **Pool** — group of items in one profile sharing N keyless unlocks per day, M minutes each.
- **Override** — key-gated suspension of blocking: (1) all off until re-enabled, (2) exempt a subset until re-enabled, (3) all off for N minutes.
- **Emergency unlock** — one of 5 lifetime per device; always performs "turn everything off until re-enabled", bypassing locked windows. No key needed.
- **Latch** — a profile's manual on/off state (flipped by user, "At" rules, and one-shot events).
- **Window** — recurring schedule block during which a profile is active regardless of latch.
- **Journal** — append-only event log (sync-ready); streak and emergency counts derive from it.

---

## 3. Product behavior (platform-neutral; the engine implements all of this)

### 3.1 Profiles
- A user has ≥1 profile. Each has `id`, `name` (≤40 chars, existing `MAX_PROFILE_NAME_LENGTH`), `color` (existing palette), and a **ProfileConfig** containing everything: web rules, app rules (blacklist/whitelist), soft rules, pools, schedule rules, one-shot events.
- **Active** ⇔ (a schedule Window covers *now* and that window occurrence is not suppressed) **OR** (its latch is On). Any number may be active.
- **Duplicate profile**: copies the entire config (new ids for pools/rules/events), name `"<name> copy"`, next palette color, latch Off, no usage history. Always free. Subject to profile-count limits.
- **Rename / recolor**: always free.
- **Delete**: key-gated if the profile is active or has any schedule rule / one-shot that could activate it; otherwise free. Cannot delete the last profile (`LAST_PROFILE`).
- **Turn on** (latch On): free (tightening). Requires ≥1 paired key.
- **Turn off** (latch Off): this is override path (2) at profile granularity → key-gated (§3.5).

### 3.2 The blocking model

Per profile:
- **Web rules**: `mode` blacklist|whitelist over domains (`blockedDomains`, `allowedDomains`), premade lists, `defaultAction`, optional AI `judge` (desktop only). This is today's `Policy` web portion unchanged in meaning (whitelist ≡ `defaultAction: block` + allow list).
- **App rules**: `mode` blacklist|whitelist over `AppRef`s. `AppRef` gains `androidPackage`. Desktop UI only offers blacklist [DEFAULT 6].
- **Soft rules**: `Record<catalogId, SiteRule>` — one rule per catalog entry; the same rule drives the website (extension) *and* the Android app (accessibility) for entries that have both (§7).
- **Pools**, **schedule rules**, **one-shots** (§3.6, §3.9).

**Per-layer decision for an item** (Hard > Soft > Allow):

| Situation in this profile | Result |
|---|---|
| Item explicitly blacklisted (domain/app) | **Hard** (even if a soft rule exists — *hard + soft = hard*) |
| Whitelist mode, item not allow-listed, catalog soft rule exists for it | **Soft** (*whitelist un-include + soft = soft*) |
| Whitelist mode, item not allow-listed, no soft rule | **Hard** |
| Item allow-listed (either mode) with soft rule | **Soft** [DEFAULT 5] |
| Blacklist mode, not listed, soft rule exists | **Soft** |
| Otherwise | **Allow** (web: fall through premade lists → `defaultAction` exactly as today's `policy_match::is_host_blocked`) |

Always-allowed on Android regardless of whitelist: Talysman itself, default launcher, System UI, active IME, default dialer, default SMS app, emergency dialer/info, and the package installer & Settings (the latter two are *guarded*, §6.7).

**Combining layers:** item is Hard if any non-exempt layer says Hard; else Soft with the **union** of blocked features (per feature, max of allow < judge < block); else Allow.

**Exemptions** remove a layer's say for an item:
- a live pool unlock exempts the item **from the profile that owns that pool only**;
- override (2) exempts chosen items from **all** layers, or removes chosen whole profiles;
- overrides (1)/(3) remove all layers (except locked ones, §3.5).

**Worked examples**
1. Profile A blacklists Instagram app; Profile B soft-rules Instagram (Reels hidden). Both active → Hard.
2. Profile A (whitelist of apps: Maps, Spotify) + soft rule on YouTube → YouTube opens, Shorts neutered.
3. Instagram in pool P of A (3/day × 10 min). Only A active → popup offers unlock; after unlock, Instagram fully usable (no soft rules either) for 10 min.
4. Same as 3, but B also active and blocks Instagram with no pool → popup shows *no* pool unlock available ("Also blocked by B"), offers override paths only.
5. Same as 3, B blocks it in B's own pool Q → one "Unlock" button spends one from P **and** one from Q; disabled if either is exhausted.

### 3.3 Keys
- **Desktop:** USB exactly as today (`native/common/src/pairing.rs`, `usb.rs`, `Keys.tsx`).
- **Android:** NFC tags and QR codes; any number paired; each has label + pairedAt.
  - **NFC:** if the tag is NDEF-writable, write a random 32-byte secret in a Talysman MIME record (`application/vnd.talysman.key`) and store `hash_secret(secret)`; else fall back to hashing the tag UID (flag `uidOnly`, UI warns UIDs are clonable). Reader via `NfcAdapter.enableReaderMode`.
  - **QR:** app generates a random 32-byte secret, renders a QR `talysman-key:v1:<base64url>` for the user to print/save elsewhere (share sheet / save to photos with a warning not to keep it on the phone); stores the hash. Scanning via CameraX + zxing-cpp (no Google Play Services dependency).
  - Hashing reuses the engine's `pairing` module (moved from `native/common/src/pairing.rs`).
- **Unpairing** is key-gated and may not remove the last key (same rule as desktop `unpairKey`, `LAST_PAIRED_KEY`).
- **Pairing** a new key while any profile is active requires verifying an already-paired key [DEFAULT 13]; with nothing active it's free (first-run setup, and recovery after an emergency unlock). **This also changes desktop:** today `pair_key` in `native/common/src/platform_core.rs` is ungated, so during focus anyone can pair a fresh USB stick and immediately use it to disable focus.
- Keys are **not** shared across platforms in v1.

### 3.4 Gating matrix (authoritative)

`Free` = allowed now. `Key` = requires key verification now (an emergency unlock is **not** accepted here). `Locked` = the key cannot affect a profile while a locked window covers it; only an emergency unlock (= everything off) gets past it.

| Action | Gate | Breaks streak |
|---|---|---|
| Create profile / duplicate / rename / recolor | Free | no |
| Turn profile on; add Window; add "On at"; add On one-shot; add items to blacklist; remove from whitelist; add soft rule / move a feature toward block; enable premade list; remove a pool; lower pool count/duration; add/raise friction; remove an item from a pool | Free (tightening) | no |
| Any relaxation of a profile that is active **or** could be activated by its schedule/one-shots (inverse of the row above: remove blacklist entry, whitelist add, blacklist↔whitelist to looser, feature toward allow, disable premade, remove/shorten window, unlock a window, add a pool, add item to a pool, raise count/duration, lower friction, **add "Off at" rule or Off one-shot**) | Key | **yes** |
| Same relaxation on a dormant, unscheduled profile | Free | no |
| Delete profile | Key if active/schedulable, else Free | yes if keyed |
| Pool unlock | Free (friction must elapse; count must remain) | no |
| Override (1) all off until re-enabled | Key; Locked profiles excepted (see §3.5) | yes |
| Override (2) exempt items / turn off whole profile(s) | Key; Locked for affected locked profiles | yes |
| Override (3) all off for N min | Key; Locked profiles excepted | yes |
| Emergency unlock (= override (1) **including** locked profiles) | Keyless; needs ≥1 emergency left + confirm | yes |
| "Re-enable all" | Free | no |
| End a locked window early | Only via emergency unlock (which turns everything off) | yes |
| Pair a key | Free when **no** profile is active; otherwise Key (an existing paired key must be verified) [DEFAULT 13] | no |
| Unpair a key | Key | no |
| Scheduled "off"/window end/one-shot off firing | automatic, no gate | no (the creation already counted) |

Relaxation is decided by a single engine function (`restrictive::config_at_least_as_restrictive(prev, next)`), an extension of today's `policy_match::is_at_least_as_restrictive` — see §4.5.

### 3.5 Overrides (key-gated)
1. **All off until re-enabled.** Every profile's latch is set Off and every in-progress window occurrence is *suppressed* until it ends. Previous latches are remembered. Future window starts and "On" rules/one-shots **still fire** and activate their profile normally [answer 17]. "Re-enable all" restores remembered latches and clears suppression.
2. **Subset off until re-enabled.** User picks items (apps/sites/catalog entries — exempted from **all** layers) and/or whole profiles (latch Off + suppress current window occurrence). Persists across schedule firings until "Re-enable all" (which clears all exemptions and restores those profiles).
3. **All off for N minutes.** Enforcement suspended until `now + N`; state changes (schedule firings) continue to be computed underneath; at expiry everything resumes automatically. "Re-enable all" ends it early.

**Locked windows**: if a locked window currently covers a profile, overrides with a key cannot affect *that* profile. The override dialog shows: "Deep Work is locked until 17:00. [Apply to other profiles] [Emergency unlock — turns everything off (n left)] [Cancel]". An emergency unlock performs override (1) on **all** profiles and records a bypass for every in-progress locked window occurrence (future locked windows start normally).

"Re-enable all" is always visible (desktop dashboard, Android home, persistent notification) while any override (1)/(2)/(3) is in effect.

### 3.6 Override pools (keyless, ScreenZen-style)
- Belong to a profile. Fields: `name`, `items` (apps / domains / catalog entries), `unlocksPerDay` (0–20), `unlockMinutes` (1–120), `friction` (none | countdown s | breathing s).
- **Validation:** an item appears in at most one pool per profile (`POOL_ITEM_CONFLICT`). An item in a pool that the profile doesn't actually block is allowed (it matters once config changes).
- **Unlock flow:** request → if friction, a `pending` unlock with `readyAt = now + friction` → confirm (rejected before `readyAt`) → exemption for `unlockMinutes` of **all blocks, hard and soft**, for every item in the pool (unlocking one pool member unlocks the whole pool — they share the budget and the window). Counter +1.
- **Counters** per (profile, pool) per **local date**; reset at local midnight; an unlock that straddles midnight counts against the day it started.
- When the unlock expires, blocking returns immediately (Android: overlay reappears if the app is foreground; desktop: extension re-blocks/rehides on next state frame; apps get killed again).
- Pool unlocks never break the streak and never need the key [answers 5, 6]. Allowed during locked windows [DEFAULT 2].

### 3.7 Emergency unlocks
- **5 per device, lifetime** (`EMERGENCY_LIFETIME_LIMIT = 5`, in `packages/product` & engine constants so it can change later). Desktop gets 5 too [answer 18].
- **What it does (Brick-style) [answer 22]:** exactly override (1) — every profile off until re-enabled — *including* profiles in locked windows (their current occurrences are bypassed). Scheduled windows/"on" events later re-enable profiles as normal. It never authorizes anything else (no config relaxation, no partial or timed off, no key unpairing); those need the key.
- It's the lost-key escape hatch: offered wherever a key prompt appears ("No key? Emergency unlock — turns everything off (n left)"), in the locked-window dialog, and in the block popup's "Other options".
- UI: explicit confirmation sheet — "Use 1 of your 3 remaining emergency unlocks? Everything will turn off until you (or a schedule) turn it back on. You can never get this unlock back. Your 12-day streak will reset." Type-to-confirm not required.
- If 0 left, the option is shown disabled ("No emergency unlocks left").
- Recorded as a journal entry; count = limit − number of `EmergencyUsed` entries (so later account sync = union of journals).
- Reinstall resets the local count in v1 (accepted; sync later).

### 3.8 Streak
- **Breaking events:** override (1), (2) (incl. turning a profile off), (3); any key-gated relaxation; emergency unlock; key-gated profile delete.
- **Not breaking:** pool unlocks; tightening; scheduled windows ending; pre-created off rules firing; free edits to dormant profiles.
- `currentDays = localDate(now) − localDate(lastBreak)` in days (0 on a break day); before any break, measured from the first day a profile was ever turned on. `bestDays` tracked.
- Shown: in every block popup, the override dialog, the emergency confirm, the dashboard (desktop) / home (Android).
- Derived from the journal (engine caches it in `StreakCache`, recomputed on load).

### 3.9 Schedules and one-shot events (per profile)
- **Window** `{days, start, end, locked}` — profile active during the window (end ≤ start ⇒ crosses midnight; start == end never matches — same semantics as today's `scheduleEngine.ts`). `locked` ⇒ key cannot end/override it (§3.5).
- **At** `{days, at, action: on|off}` — recurring latch flip ("on at 09:00", "off at 17:00"). Plain on/off schedules are expressed as one At-on + one At-off.
- **One-shot** `{atDateTime, action: on|off}` — fires once, then is marked fired and kept in history for 7 days (UI shows "Done").
- Precedence: an "off" (At or one-shot) sets the latch Off but **cannot end a window**; windows are only ended by their own end time or an emergency.
- Creating/extending anything that turns things *on* is free; creating any "off" rule/one-shot, shortening/removing windows, or unlocking a window is a relaxation → key [answer 8]. It fires later without the key.
- Missed events (device off / daemon down) are applied on next tick in chronological order: the engine keeps `lastEvaluatedAt` and replays latch flips between it and now (window state is computed, not replayed).
- Time zone / DST: engine receives the local UTC offset with every `now`; platform re-ticks on time-zone/time change; `nextWake` never more than 1 h out.

### 3.10 Block / unlock popup (the ScreenZen-style UI)
Shown on Android when a hard-blocked app is opened (full-screen `BlockActivity` over the app) and when a soft-blocked feature is hit (compact sheet); on desktop via extension `blocked.html` (sites) and an Electron frameless window (apps). Same content everywhere, rendered from engine `PopupInfo`:

```
┌──────────────────────────────────────────┐
│  [app icon]  Instagram                   │
│  Blocked by  ● Deep Work  ● Evenings     │
│                                          │
│        🔥 12-day streak (best 30)        │
│                                          │
│  Social pool · 2 of 3 unlocks left today │
│  Each unlock: 10 minutes                 │
│                                          │
│  ( breathing animation / 15 s countdown )│
│  [   Unlock for 10 min   ]  (disabled    │
│                              until ready)│
│  [   Not now   ]                         │
│  Other options ›  (key override / 4 ⚠︎   │
│                    emergency unlocks left)│
└──────────────────────────────────────────┘
```
States: pool available / friction running / exhausted ("0 of 3 left — resets at midnight") / not in any pool / blocked by multiple profiles (example 4/5 in §3.2) / soft-block variant ("Shorts are hidden by Deep Work" + same pool options). "Other options" opens the override sheet (paths 1–3; key scan or emergency).

### 3.11 Entitlements & limits
- `packages/product`: **no new limits** [answer 25] — pools, one-shots, overrides, streak, emergency unlocks are free. Existing limits unchanged (`FREE_PROFILE_LIMIT = 1` ⇒ multiple (simultaneous) profiles are Pro; `FREE_BLOCKED_SITE_LIMIT`, schedule gating via `isScheduleEnabled` as today). Add `EMERGENCY_LIFETIME_LIMIT = 5`. Add `'sideload'` to the entitlement `source` enum ⇒ always Pro. Existing limits need an app-count analogue for Android (`maxPolicyApps` already exists — reuse it).
- Android: same Supabase sign-in + `GET /api/desktop/entitlement` (add alias `/api/app/entitlement`; keep old path). The `sideload` Gradle flavor hardcodes Pro and hides upgrade UI; the `play` flavor uses the account (web checkout for now; no Play Billing). Limits enforcement uses existing `constrain*ToLimits` helpers — ported into the engine as `limits.rs` so both platforms apply identical constraints.

---

## 4. Architecture — the shared engine

### 4.1 Crate layout
Create a Cargo workspace `native/Cargo.toml` with members: `engine`, `engine-ffi`, `engine-wasm`, `common`, `linux`, `windows`, `macos` (platform crates still built only on their OS).

`native/engine/` (crate `talysman_engine`). Deps: `serde`, `serde_json`, `sha2`, `hex`, `regex` (if needed by catalog validation), `ts-rs` (feature `ts`). **Forbidden:** tokio, `SystemTime::now`, `chrono::Local`, `rand`, filesystem.

Moved in from `native/common/src` (re-exported from `native/common/src/lib.rs` via `pub use talysman_engine::{…}` so daemon code compiles unchanged): `policy.rs`, `policy_match.rs`, `site_catalog.rs`, `premade_lists.rs`, `premade_list_ids.rs`, `pairing.rs` (hash/verify only; `generate_secret` takes entropy from caller), plus `resources/`. Premade lists behind cargo feature `premade` (default on; Android enables only if VPN DNS ships).

New modules:
| Module | Responsibility |
|---|---|
| `time.rs` | `LocalNow { epoch_ms: i64, utc_offset_s: i32 }`, local date/weekday/minute helpers |
| `model.rs` | all persisted types (§4.2) |
| `schedule.rs` | window/At/one-shot evaluation, next edge; **replaces** all three `native/*/src/schedule.rs` and `packages/core/src/scheduleEngine.ts` |
| `activation.rs` | which profiles are active now (windows, latches, suppression, locked bypass) |
| `effective.rs` | layers, exemptions, `decide_host`, `decide_app`, `decide_feature` |
| `restrictive.rs` | whole-config relaxation comparison (§4.5); replaces `packages/core/src/restrictiveness.ts` |
| `gate.rs` | command → `Gate` |
| `pools.rs`, `overrides.rs`, `streak.rs`, `journal.rs`, `limits.rs` | feature logic |
| `commands.rs`, `engine.rs` | public API |
| `migrate.rs` | v5 daemon state → v6 |
| `catalog.rs` | web + Android catalog loading/validation (from generated JSON) |

`native/engine-ffi/` — uniffi (proc-macro) wrapper: `Engine` object behind `Mutex`, records/enums mirrored. Built with `cargo-ndk` for `arm64-v8a`, `armeabi-v7a`, `x86_64`. Also buildable for host JVM (for Android unit tests).

`native/engine-wasm/` — wasm-bindgen JSON facade used by `mockService.ts` and Vitest parity tests: `apply(stateJson, cmdJson, authJson, ctxJson)`, `tick`, `gate`, `effective`, `popupInfo`.

### 4.2 Data model (Rust, `model.rs`; TS generated)
```rust
pub struct EngineState {
  pub schema: u32,                 // 6
  pub device_id: String,
  pub profiles: Vec<Profile>,
  pub overrides: Overrides,
  pub pool_usage: Vec<PoolUsage>,          // keyed by (profile_id, pool_id)
  pub pending_unlocks: Vec<PendingPoolUnlock>,
  pub journal: Vec<JournalEntry>,
  pub journal_seq: u64,
  pub streak: StreakCache,
  pub last_evaluated_ms: i64,
  pub first_enabled_local_date: Option<String>,
}
pub struct Profile { id, name, color, created_at_ms: i64, config: ProfileConfig, latch: Latch }
pub enum Latch { On { since_ms: i64, source: LatchSource /* User|AtRule|OneShot|Migration */ }, Off }
pub struct ProfileConfig {
  pub web: WebRules,     // { mode: BlockMode, blocked_domains, allowed_domains, premade_lists, default_action: RuleAction, judge: Option<JudgePolicy> }
  pub apps: AppRules,    // { mode: BlockMode, blocked: Vec<AppRef>, allowed: Vec<AppRef> }
  pub soft: BTreeMap<CatalogId, SiteRule>,
  pub pools: Vec<Pool>,
  pub schedule: Vec<ScheduleRule>,
  pub one_shots: Vec<OneShotEvent>,
}
pub enum BlockMode { Blacklist, Whitelist }
pub struct AppRef { label, windows_image_name: Option, linux_process_name: Option, mac_bundle_id: Option, android_package: Option }
pub struct Pool { id, name, items: Vec<ItemRef>, unlocks_per_day: u8, unlock_minutes: u16, friction: Friction }
pub enum Friction { None, Countdown { secs: u16 }, Breathing { secs: u16 } }
pub enum ItemRef { Domain(String), App(AppRef), Catalog(CatalogId) }
pub enum ScheduleRule {
  Window { id, days: WeekdaySet, start_min: u16, end_min: u16, locked: bool },
  At { id, days: WeekdaySet, at_min: u16, action: OnOff },
}
pub struct OneShotEvent { id, at_ms: i64, action: OnOff, fired_at_ms: Option<i64> }
pub struct Overrides {
  pub all_off: Option<AllOff>,            // path 1: { since_ms, prior_latches: Vec<(ProfileId, Latch)>, suppressed: Vec<WindowOccurrence> }
  pub exempt: Option<Exempt>,             // path 2: { since_ms, items: Vec<ItemRef>, profiles: Vec<ProfileId>, prior_latches, suppressed }
  pub timed: Option<TimedOff>,            // path 3: { until_ms }
  pub locked_bypass: Vec<WindowOccurrence>, // emergency-ended locked windows
}
pub struct WindowOccurrence { profile_id, window_id, start_ms: i64, end_ms: i64 }
pub struct PoolUsage { profile_id, pool_id, local_date: String, used: u8, active_until_ms: Option<i64> }
pub struct PendingPoolUnlock { profile_id, pool_id, requested_ms, ready_ms }
pub struct JournalEntry { id: String /* "<device_id>:<seq>" */, device_id, seq: u64, at_ms, local_date, kind: JournalKind }
pub enum JournalKind {
  ProfileOn{profile_id, source}, ProfileOff{profile_id, source},
  OverrideStarted{kind, auth}, OverrideEnded{kind}, Relaxed{profile_id, summary}, Tightened{profile_id},
  PoolUnlocked{profile_id, pool_id, minutes}, EmergencyUsed{for_action}, KeyPaired, KeyUnpaired,
  WindowStarted{..}, WindowEnded{..}, OneShotFired{..},
}
pub struct StreakCache { current_days: u32, best_days: u32, last_break_local_date: Option<String> }
```
- **Paired key records** (hashes) stay **outside** the engine state in each platform's secure store (desktop: existing `platform_secure_store.rs`; Android: Keystore-wrapped EncryptedFile). The engine only needs `has_paired_keys: bool` in `Ctx`.
- **Sync-readiness:** journal ids are globally unique (`device_id:seq`), entries immutable; future sync = union merge; emergency count and streak are pure functions of the merged journal. Journal compaction: keep all breaking/emergency entries forever; other kinds pruned after 90 days.

### 4.3 Engine API
```rust
pub struct Ctx { pub now: LocalNow, pub entropy: [u8; 16], pub has_paired_keys: bool, pub platform: Platform /* Linux|Windows|Mac|Android */ }
pub enum Auth { None, KeyVerified { key_id: String }, Emergency }
pub enum Gate { Free, NeedsKey, Locked { until_ms: i64, profiles: Vec<ProfileId> }, Denied { code: ErrorCode, message: String } }

impl Engine {
  pub fn load(json: &str, ctx: &Ctx) -> Result<Engine, EngineError>;   // runs migrations + streak recompute
  pub fn export(&self) -> String;
  pub fn gate(&self, cmd: &Command, ctx: &Ctx) -> Gate;                // dry run, used by UIs to show 🔑 before submit
  pub fn apply(&mut self, cmd: Command, auth: Auth, ctx: &Ctx) -> Result<Applied, EngineError>;
  pub fn tick(&mut self, ctx: &Ctx) -> Tick;                           // fire due events, expire unlocks/overrides, roll date
  pub fn effective(&self, ctx: &Ctx) -> EffectivePolicy;
  pub fn decide_host(&self, host: &str, ctx: &Ctx) -> Decision;
  pub fn decide_app(&self, app: &AppIdentity, ctx: &Ctx) -> Decision;
  pub fn decide_url(&self, url: &str, extension_capable: bool, ctx: &Ctx) -> Decision; // host decision + route-level page decision for extension-less browsers
  pub fn popup_info(&self, item: &ItemRef, ctx: &Ctx) -> PopupInfo;
  pub fn snapshot(&self, ctx: &Ctx) -> EngineSnapshot;                  // what UIs render
}
pub struct Applied { pub journal: Vec<JournalEntry>, pub tick: Tick }
pub struct Tick { pub effective: EffectivePolicy, pub next_wake_ms: i64, pub events: Vec<EngineEvent> }
pub struct EffectivePolicy { pub generation: u64, pub suspended_until_ms: Option<i64>, pub layers: Vec<Layer>, pub exemptions: Vec<Exemption> }
pub struct Layer { pub profile_id, pub web: WebRules, pub apps: AppRules, pub soft: BTreeMap<CatalogId, SiteRule> }
pub struct Decision { pub verdict: Verdict /* Allow | Soft{features: BTreeMap<String,RuleAction>} | PageBlocked{site, feature} | Hard */, pub blocking_profiles: Vec<ProfileId>, pub pools: Vec<PoolRef> }
pub struct PopupInfo { item, verdict, blocking_profiles: Vec<ProfileSummary>, pools: Vec<PoolStatus /* name, left, per_day, minutes, friction, pending_ready_ms */>, unlock_available: bool, streak: StreakCache, emergency_left: u8, locked_until_ms: Option<i64>, override_options: Vec<OverrideKind> }
```
**Commands:** `UpsertProfile{profile}`, `DuplicateProfile{id}`, `DeleteProfile{id}`, `SetLatch{id, on}`, `SetConfig{id, config}`, `AddOneShot`, `RemoveOneShot`, `RequestPoolUnlock{profile, pool}`, `ConfirmPoolUnlock{profile, pool}`, `CancelPoolUnlock`, `UnlockItem{item}` (convenience: requests on all blocking pools), `StartOverrideAll`, `StartOverrideExempt{items, profiles}`, `StartOverrideTimed{minutes}`, `ReenableAll`, `EmergencyUnlock` (= `StartOverrideAll` + bypass of every in-progress locked occurrence; only command accepting `Auth::Emergency`), `NoteKeyPaired`, `NoteKeyUnpaired`.

`Auth::Emergency` is accepted **only** with `EmergencyUnlock`; for any other command the engine returns `BAD_REQUEST`. `EmergencyUnlock` with `Auth::None` is valid (it is keyless) but fails `NO_EMERGENCY_LEFT` when the ledger is exhausted.

**Error codes** (added to `packages/shared/src/constants.ts` and Rust constants): existing `KEY_REQUIRED`, `LOCKED`, `NO_PAIRED_KEY`, `LAST_PROFILE`, `BAD_REQUEST` plus `NO_EMERGENCY_LEFT`, `POOL_EXHAUSTED`, `FRICTION_PENDING`, `POOL_ITEM_CONFLICT`, `LIMIT_EXCEEDED`, `NOT_BLOCKED`.

**Platform contract:** platform calls `gate()`; if `NeedsKey`, platform verifies its key (desktop: `recompute_presence()` → USB; Android: launch key scan) and calls `apply(cmd, KeyVerified)`. If the user instead chooses the emergency escape, the platform issues the separate `EmergencyUnlock` command (not the original command); the engine checks the remaining count. The engine **never** trusts `KeyVerified` from a UI — on desktop only the daemon constructs it after its own USB check; on Android the key-scan activity is in-process with the engine host.

**next_wake_ms** = min(next window edge, next At, next one-shot, pool expiry, pending friction ready, timed override expiry, locked bypass expiry, next local midnight, now + 1 h).

### 4.4 Evaluation algorithm (summary)
1. `tick`: replay latch flips from At rules and one-shots in `(last_evaluated_ms, now]` in order (an On firing re-latches its profile; windows starting also clear suppression for *new* occurrences automatically since suppression is per occurrence); expire pool unlocks, pending unlocks older than 10 min, timed override, suppressions/bypasses whose occurrence ended; roll pool counters on date change; recompute streak; bump `generation` if effective changed.
2. `effective`: if `timed` active ⇒ layers = only *locked* profiles' layers. Else active profiles (§3.1) minus those removed by overrides (unless locked & not bypassed) → layers; exemptions = live pool unlocks (per profile) + `exempt.items` (all layers).
3. `decide_*`: per layer, per §3.2 table, skipping exempted; combine.

### 4.5 Restrictiveness
`restrictive::config_at_least_as_restrictive(prev: &ProfileConfig, next: &ProfileConfig) -> Result<(), Vec<Relaxation>>` — returns the list of relaxations (for UI messaging: "Removing instagram.com from your blacklist needs your key"). Rules = today's `policy_match::is_at_least_as_restrictive` (blocked host unblocked, app removed, site feature toward allow unless primary host hard-blocked, weaker `defaultAction`, judge removed while relied on, premade disabled) **plus**: mode Whitelist→Blacklist (or whitelist additions / blacklist removals for apps), pool added / item added / per-day or minutes raised / friction lowered, window coverage reduced (compare minute-sets per weekday) or window unlocked, At-off or one-shot-off added, At-on/one-shot-on removed. Profile-level check "can this profile become active" (`activation::is_schedulable`) decides whether relaxations need the key. Property test: if `config_at_least_as_restrictive` passes then for a corpus of hosts/apps/features, every `decide_*` is at least as strict.

### 4.6 Time
Platforms pass wall clock + UTC offset. Desktop: `chrono::Local` in the daemon shell. Android: `System.currentTimeMillis()` + `TimeZone.getDefault().getOffset(now)`. Android anti-tamper: host records `(wall, elapsedRealtime)` pairs; if wall clock moves backwards by >2 min relative to elapsed while any pool/timed override is live, the host passes `now = lastTrusted + elapsedDelta` instead (prevents extending unlocks by setting the clock back). Date & time settings are also guarded (§6.7).

### 4.7 TypeScript integration
- `ts-rs` derives on engine model/API types → `packages/shared/src/generated/*.ts`, produced by `cargo test -p talysman_engine --features ts export_bindings`. New script `pnpm gen:types`; CI/`pnpm check` step fails on diff.
- `packages/shared/src/{profile,policy,schedule,protocol}.ts` re-export generated types; keep only TS-only helpers (palette, labels, UI presets like `PolicyPreset`).
- Delete `packages/core/src/scheduleEngine.ts` and `restrictiveness.ts` once consumers use the wasm engine / daemon dry-run (`gate`). Keep `policyNormalize.ts` (UI input normalization) unless it's moved into the engine too (preferred: engine exposes `normalize_config`).
- `apps/desktop/src/main/service/mockService.ts` and `tests/helpers/mockService.ts` run `engine-wasm` so e2e tests exercise real semantics.
- `native/protocol/schema.json` becomes generated from the same types (or deleted in favor of the generated TS, with a note in `snorlax-architecture.md` §6).

---

## 5. Desktop changes

### 5.1 Daemon (`native/common/src/platform_core.rs`, per-platform crates)
- `Core` becomes a thin shell holding `engine: Engine`, the secure store, `EnforceShared`, broadcast channel, judge brokering (unchanged), and usage log.
- `dispatch`: parse RPC → `Command`; `engine.gate()`; if `NeedsKey` and the request didn't set `useEmergency`, run `recompute_presence()` (fresh USB enumeration via `usb::present_key_ids`) → `KeyVerified` or `KEY_REQUIRED`; if `Locked` → `LOCKED` (with `until`); apply; persist; `apply_effective()`; emit events.
- Delete `native/{linux,windows,macos}/src/schedule.rs`; each `service.rs` sleeps until `min(tick.next_wake_ms, judge sweep)` instead of `next_schedule_delay`.
- `EnforceShared` stores `EffectivePolicy`. `policy_match::is_host_blocked`, `effective_dns_sinkhole_domains`, `is_app_blocked` become layer-aware (take `&EffectivePolicy`). Enforcement files touched: `native/linux/src/enforce/{dns,nft,apps,extension_policy}.rs`, Windows `enforce/*` (divert/firewall/apps), macOS `enforce/*` (pf/hosts/apps). **Land layer-awareness first with a single-layer parity test** (one active profile must produce byte-identical DNS/nft/pf outputs to v5).
- `apps.rs` (process killer) emits `appBlocked { app, popupInfo }` after killing a process (debounced 5 s per app) so Electron can show the popup.
- `focus_cli.rs` / tray helpers: "enable focus" = `SetLatch(on)` for all profiles marked `primary` (new optional flag, default: the profile that was active in v5), "disable focus" = `StartOverrideAll` (key-gated as today).
- `rearm_on_boot`: load engine, `tick`, apply effective. If no paired keys, latches forced Off (current behaviour).

### 5.2 State migration v5 → v6 (`engine::migrate::from_v5`, called by `platform_state.rs::load`)
- Each v5 `Profile{policy}` → `ProfileConfig` (web rules copied; `mode = Whitelist` iff `defaultAction == block && allowedDomains non-empty`; apps → blacklist).
- Each global `ScheduleWindow{profileId?}` → a `Window` on `profileId` (or on v5 `activeProfileId` if unset), preserving `locked`.
- If v5 `focusActive && focusSource != schedule` → latch On for v5 `activeProfileId`; mark it `primary`.
- Emergency count 5, streak starts at migration date (if focus was ever on) — journal gets a `Migration` marker.
- Write `state.v5.json.bak` alongside; migration is one-way. Fixture tests from real v5 state files for every shape in today's `migration_tests`.

### 5.3 Protocol v6 (`packages/shared/src/protocol.ts`, `native/common/src/constants.rs` `PROTOCOL_VERSION = 6`)
- `getState` → `ServiceState { protocolVersion, serviceVersion, snapshot: EngineSnapshot /* profiles, activeProfileIds, overrides, poolStatus, streak, emergencyLeft, effective summary, nextEvents */, settings, pairedKeys, keyPresent, presentKeyId, focusActive /* derived: any layer */ }`.
- New RPCs: `applyCommand { command, dryRun?: boolean, useEmergency?: boolean } → { gate } | Ok`, `getPopupInfo { item } → PopupInfo`.
- Removed after one release (kept as shims translating to commands in v6): `setPolicy`, `setProfile`, `deleteProfile`, `setActiveProfile`, `setSchedule`, `enableFocus`, `disableFocus`, `toggleFocus`.
- New events (`packages/shared/src/events.ts`): `stateChanged` (full snapshot), `effectiveChanged`, `appBlocked`, `poolUnlockChanged`, `streakChanged`.
- Electron main (`apps/desktop/src/main/ipc/{channels,handlers}.ts`, `preload/index.ts`, `renderer/lib/bridge.ts`) exposes `applyCommand`, `gate`, `getPopupInfo`, and forwards `appBlocked`.
- Old UI + new daemon: version check already exists (`daemon-compatibility-rollback.md`); refuse with the existing "update required" UX.

### 5.4 Native messaging & extension
- `natmsg_frames.rs`: `SITE_CAPABILITY = 4`. The `state` frame carries `layers[]` (each: blocked/allowed domains, premade ids, default action, sites with resolved features, `layerId`), `exemptions`, `suspendedUntil`. For extensions with capability < 4, `flatten_conservative()` (any-layer-block ⇒ block; fail closed).
- New extension → host → daemon frames (relayed like `judge-request` in `platform_unix_natmsg.rs` and the Windows equivalent): `popup-info {url}`, `pool-unlock-request {profileId, poolId}`, `pool-unlock-confirm {…}`. Responses routed back to the requesting tab.
- `apps/extension/src/site-engine.js`: `decide()` iterates layers, skips exempted items, combines (Hard > Soft-union > Allow). `rules.js`: DNR compile from the combined result (hard-blocked hosts at priority 1000; allow rules only if no layer blocks). `site-content.js`: hides the union of blocked features (already data-driven). `judgeRequest` includes `layerId`.
- `blocked.html` / `blocked.js` / `blocked.css`: render §3.10 from `popup-info`: streak, blocking profiles, pool status, friction (countdown + CSS breathing animation), unlock button → request/confirm → navigate back to the original URL once the next `state` frame exempts it. "Other options" opens the desktop app (`talysman://override`) — overrides that need the USB key happen in the app.
- **Firefox for Android transport:** Fenix doesn't support `runtime.connectNative`. `background.js` gets a `transport` abstraction: `NativePortTransport` (existing) and `LoopbackTransport` — WebSocket to `ws://127.0.0.1:<port>` served by the Android app (§6.8), authenticated with a token paired via `talysman://ext-pair?token=…` opened from the Android app into the extension's options page. Same frames either way. Capability announced in handshake.
- Bump extension version; rebuild via `pnpm build:extension`; audit via `pnpm audit:extension`.

### 5.5 Desktop renderer (`apps/desktop/src/renderer`)
- `components/ProfilePicker.tsx` → **ProfileList**: each profile with on/off switch (off opens OverrideDialog scoped to that profile), color, "active because: window until 17:00 / manually / one-shot", menu: Edit, Duplicate, Delete.
- `pages/Blocklists.tsx` → **ProfileEditor** (per profile tabs): *Websites* (mode toggle, lists, premade lists, AI judge via `JudgeSettings.tsx`), *Apps* (blacklist), *Soft blocks* (`SiteRules.tsx`, catalog), *Pools* (new `components/PoolEditor.tsx`: items picker from the profile's blocked items, count, minutes, friction), *Schedule* (moved from `pages/Schedule.tsx`: windows with lock toggle, "On at"/"Off at" rules, one-shot events with date-time picker).
- Every save calls `applyCommand{dryRun:true}` first; if `NeedsKey`, show 🔑 "Insert your key to save — this loosens an active profile and will reset your N-day streak" and list the relaxations returned by the engine. (No emergency option here — emergency only ever means "everything off".)
- `components/FocusToggle.tsx` → **OverrideControls**: "Turn everything off" / "Turn off some…" / "Pause for…" / "Re-enable all".
- New: `components/OverrideDialog.tsx`, `components/StreakBadge.tsx`, `components/EmergencyConfirm.tsx`, `components/PoolUnlockPopup.tsx` (shared by a new frameless `popup` BrowserWindow route created in `apps/desktop/src/main/index.ts` on `appBlocked`).
- `pages/Dashboard.tsx`: active profiles, streak, emergency left, active overrides/unlocks with countdowns, upcoming events.
- `store/useFocusStore.ts`: new snapshot shape; remove `activeProfileId` single-selection.
- Pro gating per `packages/product` limits (multi-profile, pools, one-shots).

---

## 6. Android app — "Talysman for Android" (phase 3)

### 6.1 Gradle layout (`apps/android`)
- `settings.gradle.kts`: `rootProject.name = "talysman-android"`; include `:app` (Insights — unchanged package `app.talysman.insights`), `:blocker` (new, `app.talysman.android`), `:engine` (Android library: uniffi-generated Kotlin + `jniLibs` from `cargo-ndk`), `:designsystem` (TalysmanTheme, palette, shared Compose components).
- Move the `generatePalette` task from `app/build.gradle.kts` into `apps/android/build-logic` (convention plugin, package name as parameter) used by `:designsystem`.
- `:engine` Gradle task `cargoNdkBuild` → `native/engine-ffi` for 3 ABIs + `uniffi-bindgen generate` → `build/generated/uniffi`. Requires NDK r27+ and `cargo-ndk`; document in `apps/android/README.md` (and nix shell if applicable).
- `:blocker` product flavors: `sideload` (`BuildConfig.ENTITLEMENT_SOURCE = "sideload"`, Pro always, upgrade UI hidden, includes Device Admin) and `play` (account entitlement; Device Admin behind a remote flag). minSdk 26, target/compile 36, Kotlin 2.0.21, Compose BOM matching Insights.
- Release: sideloaded APK signed with a real (non-debug) release key stored under `local-credentials/`; upload to the existing S3 release bucket alongside desktop artifacts (extend `scripts/upload-release.mjs`); download link on talysman.app later.

### 6.2 Package structure (`apps/android/blocker/src/main/java/app/talysman/android/`)
| Package | Contents |
|---|---|
| `engine/` | `EngineHost` — single-thread actor owning the uniffi `Engine`; atomic JSON persistence (`filesDir/engine-state.json`, write-temp-then-rename, `.bak` of last good); exposes `StateFlow<EngineSnapshot>`; all commands go through it; builds `Ctx` (time, SecureRandom entropy, has_paired_keys). |
| `service/` | `EnforcementService` (foreground service, type `specialUse`, persistent notification: active profiles, streak, "Re-enable all" action when overridden); `WakeScheduler` (`AlarmManager.setExactAndAllowWhileIdle` at `next_wake_ms`; `SCHEDULE_EXACT_ALARM` permission with fallback to inexact + 1 h cap); `BootReceiver`; `TimeChangeReceiver` (`TIME_SET`, `TIMEZONE_CHANGED`, `DATE_CHANGED`). |
| `a11y/` | `TalysmanAccessibilityService` (foreground app detection, hard-block overlay, browser URL reading, self-protection guards); `AppFeatureEngine` (phase 4 soft blocks); `BrowserUrlReader` (catalog-driven URL-bar ids per browser). |
| `block/` | `BlockActivity` (full-screen popup §3.10, `excludeFromRecents`, `singleInstance`), `SoftBlockSheet`. |
| `keys/` | `NfcKeyReader`, `NfcKeyWriter`, `QrKeyGenerator`, `QrScannerActivity` (CameraX + zxing-cpp), `KeyStore` (Keystore-wrapped EncryptedFile of `SaltedHash` records), `KeyVerifyActivity` (returns verified key id to caller for exactly one command). |
| `admin/` | `TalysmanDeviceAdmin` (sideload flavor): makes uninstall require deactivating admin, which is itself guarded. |
| `vpn/` | `DnsVpnService` (optional, off by default, "Block sites in all apps"): local VpnService that answers DNS for hard-blocked domains with NXDOMAIN/0.0.0.0 and forwards the rest; uses engine `effective_dns_sinkhole_domains`. |
| `bridge/` | `LoopbackBridge` — WebSocket server on 127.0.0.1 for the Firefox extension (§6.8). |
| `account/` | Supabase auth (deep link `talysman://auth/callback` from `packages/auth-contracts`), entitlement fetch & cache (mirrors desktop `offlineEntitlement.ts` semantics: cache + 30-day grace). |
| `ui/` | Compose screens (§6.6). |
| `apps/` | `InstalledAppsRepository` (launcher-visible apps via `PackageManager`, icons, labels; requires `QUERY_ALL_PACKAGES` in sideload flavor or `<queries>` intent filter for Play). |

### 6.3 Permissions / onboarding
Walkthrough in order, each with rationale screen: Accessibility service (required) · Notifications · Exact alarms · Ignore battery optimizations · Camera (only when pairing QR) · NFC (hardware check) · Device Admin (sideload; optional but recommended) · VPN (only if enabled). Status panel in Settings shows any revoked permission; when accessibility is disabled while a profile is active, the foreground notification escalates ("Talysman protection is off") — cannot be prevented, but guarded (§6.7).

Manifest: `BIND_ACCESSIBILITY_SERVICE` service with `accessibility_service_config.xml` (`typeWindowStateChanged|typeWindowContentChanged|typeViewTextChanged`, `flagReportViewIds`, `flagRetrieveInteractiveWindows`, `canRetrieveWindowContent=true`), `FOREGROUND_SERVICE_SPECIAL_USE`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `NFC`, `CAMERA`, `POST_NOTIFICATIONS`, `INTERNET`.

### 6.4 Hard blocking
- On `TYPE_WINDOW_STATE_CHANGED` → foreground package (ignore our own + system overlays + IME) → `engine.decide_app(AppIdentity::Android(pkg))`.
  - `Hard` → `performGlobalAction(GLOBAL_ACTION_HOME)` then launch `BlockActivity` with `PopupInfo` (~150 ms, avoid flash with a `TYPE_ACCESSIBILITY_OVERLAY` cover view while transitioning).
  - `Soft` → hand to `AppFeatureEngine` (phase 4); before phase 4, catalog apps with soft rules are **allowed** (phase 3 ships hard-block only; documented in release notes).
- Re-check on every tick/effective change for the current foreground app (so pool expiry re-blocks immediately).
- **Browsers** (Chrome, Chrome variants, Edge, Brave, Samsung Internet, Firefox, Opera — list in the Android catalog with URL-bar view ids): read URL on content/text change (debounced 300 ms) → `engine.decide_url(url)`. `Hard` → overlay + `BlockActivity`, then navigate back (GLOBAL_ACTION_BACK). **Soft-ruled sites in extension-less browsers are route-level only [answer 24]:** `decide_url` classifies the URL with the catalog routes (same semantics as `classifyUrl` in `apps/extension/src/site-engine.js`: lowercased path, trailing slash trimmed, first matching route wins, else `fallbackFeature`); if that page's feature resolves to `block` in the combined layers → `PageBlocked{feature}` → `SoftBlockSheet` ("YouTube Shorts are blocked by Deep Work", pool options) + back; otherwise allow with no element hiding. Example: `youtube.com/` (feed) and `/shorts/…` blocked, `/watch?v=…` and `/results` allowed. In Firefox with the Talysman extension connected (bridge heartbeat), the accessibility layer defers soft decisions to the extension and only enforces Hard.
- This requires the engine to carry full route data: the generator's native catalog JSON (`native/common/resources/site-catalog.json`, moving to `native/engine/resources/`) gains `appHosts`, `routes` (path/query regexes, host), and `fallbackFeature`; engine `catalog.rs` implements `classify_url` with the `regex` crate (catalog regexes are already RE2-compatible). Parity test: every catalog `examples` fixture must classify identically in Rust and in `site-engine.js`.
- **Unknown browsers** (apps that handle `ACTION_VIEW http`) are hard-blocked while any profile with web rules is active [DEFAULT 4], unless allow-listed explicitly.
- Whitelist mode: always-allowed system set (§3.2) computed at runtime from `RoleManager`/default handlers.

### 6.5 Overrides, pools, keys on Android
- Override sheet (from home, notification, or BlockActivity "Other options"): three paths; each calls `EngineHost.gate`; `NeedsKey` → `KeyVerifyActivity` (choose NFC tap or QR scan; either paired key works) → `apply(KeyVerified)`. A separate, visually de-emphasized "Lost your key? Emergency unlock — turns everything off (n left)" row → `EmergencyConfirm` → `apply(EmergencyUnlock, Auth::None)`. Config screens show the key prompt only (no emergency option).
- Pool unlock in BlockActivity: `RequestPoolUnlock` → friction UI (countdown ring / breathing animation matching ScreenZen screenshot) → `ConfirmPoolUnlock` → finish and relaunch the target app (`getLaunchIntentForPackage`) or reload URL in browser.
- Timed override & pool expiry: `WakeScheduler` alarm → `tick` → accessibility service re-evaluates foreground.

### 6.6 Compose screens (`ui/`)
Onboarding/permissions · Home (active profiles with switches, streak, emergency left, overrides in effect + Re-enable all, next scheduled events) · Profiles list (duplicate/delete) · Profile editor tabs: Apps (mode toggle, installed-app picker with search/icons), Websites (mode, domains, premade lists — no AI), Soft blocks (catalog entries with feature toggles, shared labels from catalog), Pools, Schedule (windows / On at / Off at / one-shots) · Keys (pair NFC, pair QR, list/unpair) · Account (sign in, plan; hidden upgrade in sideload) · Settings (VPN DNS toggle, unsupported-browser blocking, permissions status, Firefox extension pairing) · BlockActivity / SoftBlockSheet / OverrideSheet / EmergencyConfirm / KeyVerify. Use `:designsystem` palette; mirror desktop copy.

### 6.7 Tamper resistance (while any profile is active or any locked window is upcoming within 5 min)
Accessibility guards, driven by a declarative `guards` section of the Android catalog (package + activity/view-id/text matchers, localized strings where needed): Talysman's App-info page (Force stop / Uninstall / Clear storage), Accessibility settings pages for Talysman, Device admin deactivation, Date & time settings, Private DNS & VPN settings (if VPN enabled), package-installer uninstall dialog for Talysman, Developer options (optional toggle). Guard action = BACK + toast "Protected while Deep Work is on". Safe-mode/ADB bypasses are out of scope (documented in threat model, like desktop §2).

### 6.8 Firefox extension bridge
`LoopbackBridge`: WebSocket on `127.0.0.1` random port (persisted), accepts only connections presenting the paired token (`Sec-WebSocket-Protocol: talysman.<token>`); speaks the same frame set as natmsg (`state`, `popup-info`, `pool-unlock-*`, heartbeat). Pairing: Android Settings → "Connect Firefox" → opens `https://addons.mozilla.org/...` if not installed, then `talysman://ext-pair` link opened in Firefox → extension options page stores port+token. Heartbeat loss while Firefox is foreground ⇒ Firefox treated as an extension-less browser (soft-ruled sites Hard).

### 6.9 Entitlement
`sideload` flavor: `Entitlement(plan=pro, source="sideload")` synthesized locally; sign-in optional. `play` flavor: sign-in required for Pro; free limits applied through engine `limits.rs` using `limitsForPlan` values generated from `packages/product` (export constants to JSON at build time, consumed by both engine and Kotlin).

---

## 7. Android soft blocks (phase 4)

### 7.1 Catalog extension (`packages/shared/src/sites/`)
Add to `types.ts`:
```ts
export interface AndroidAppDefinition {
  packages: string[];                       // e.g. ['com.google.android.youtube']
  /** Screens/UI regions mapped to this entry's feature ids (same vocabulary as the web site). */
  screens: AndroidScreenMatcher[];
}
export interface AndroidNodeMatch { viewId?: string; text?: string /* regex */; contentDesc?: string /* regex */; className?: string; activity?: string; selected?: boolean }
export interface AndroidScreenMatcher {
  feature: string;
  /** All-of: every match must be present in the active window tree. */
  match: AndroidNodeMatch[];
  /** back = GLOBAL_ACTION_BACK; home; overlay = cover region/screen with a "hidden by Talysman" card; clickAlternative = click a node (e.g. switch to Subscriptions tab). */
  action: 'back' | 'home' | 'overlay' | 'clickAlternative';
  alternative?: AndroidNodeMatch;
  /** Optional: only hide specific sub-nodes (overlay drawn over their bounds) instead of the whole screen. */
  hideNodes?: AndroidNodeMatch[];
}
// SiteDefinition gains: android?: AndroidAppDefinition
// New standalone entries for app-only services use defineApp({...}) with the same shape minus web fields.
```
- Web entries `youtube`, `instagram`, `reddit` gain `android` blocks sharing feature ids (e.g. `shorts`, `feed`, `recommendations`, `reels`, `explore`) so one `SiteRule` drives both. New entries: `facebook` (web + android: `reels`, `feed`, keep `messages`/`groups`/`marketplace`), `snapchat` (app-only: `spotlight`, `discover`; keep `chat`, `camera`, `stories` of friends).
- Initial v1 targets [answer 16]: YouTube `shorts` (Shorts tab + Shorts player → back/clickAlternative to Home or Subscriptions; shelves overlay-hidden), Instagram `reels` + `explore` (Reels tab/player → back; Explore grid → overlay; keep DMs, stories, profile, search-by-name), Facebook `reels` + `feed`, Snapchat `spotlight` + `discover`, Reddit `feed` (home/popular → overlay; keep subreddits you open, inbox, chat).
- `scripts/generate-site-catalog.ts` + `scripts/lib/site-catalog.ts`: validate (feature ids exist, regex compile, packages unique across entries) and emit `native/engine/resources/catalog.json` (engine: ids, features, hosts, packages) and `apps/android/blocker/src/main/assets/android-catalog.json` (matchers, guards, browser URL-bar ids).
- Catalog also gets `browsers` (package → URL-bar view ids, extension-capable flag) and `guards` (§6.7) sections — all Android enforcement is data-driven; **no Kotlin code names a specific app**, same rule as the web engine (`packages/shared/src/sites/README.md`).

### 7.2 Runtime (`a11y/AppFeatureEngine.kt`)
On window state/content changes for a package with a Soft verdict: debounce 150 ms, walk `rootInActiveWindow` once, evaluate matchers for the blocked features only, apply the first matching screen's action; overlays are `TYPE_ACCESSIBILITY_OVERLAY` views positioned over node bounds, updated on scroll. Rate-limit actions (max 1 back per 700 ms) to avoid loops; if a matcher fires >5 times in 10 s, escalate to a full-screen `SoftBlockSheet`. Pool unlock on the SoftBlockSheet exempts the whole app per §3.6.

### 7.3 Maintenance
App updates break view ids. Add a debug-only "Dump screen" action (writes the node tree JSON to Downloads) to build fixtures, and a catalog `minVersion/maxTested` note per matcher so the UI can warn "YouTube updated; Shorts blocking may be degraded".

---

## 8. Phases & acceptance criteria

**Phase 0 — spec.** Save this doc as `android-and-overrides-spec.md`; commit.

**Phase 1 — engine + daemon migration (no UI changes visible except via shims).**
1. Cargo workspace; create `native/engine`, move pure modules, re-export from `native/common`.
2. Model, schedule, activation, effective, restrictive, gate, pools, overrides, streak, journal, limits, migrate.
3. `engine-wasm`, `ts-rs` generation, `pnpm gen:types`; switch `packages/shared` to generated types; mock service on wasm.
4. Daemon shell rewrite (`platform_core.rs`, `platform_state.rs`), delete per-platform `schedule.rs`, layer-aware enforcement with single-layer parity tests, protocol v6 + v5 shims, natmsg capability 4 + conservative flattening.
*Accept:* all existing tests pass; an upgraded v5 install behaves identically (same blocks, same key prompts); new RPCs exercised by Rust + Vitest tests.

**Phase 2 — desktop UI & extension.** Renderer changes (§5.5), extension layers + blocked-page popup + pool unlock frames, Electron app-blocked popup, Pro gating. *Accept:* Playwright e2e for multi-profile activation, pool unlock with friction (sites + apps), overrides 1/2/3 with USB and with emergency, locked-window refusal, streak display/reset, one-shot firing, profile duplicate.

**Phase 3 — Android app (hard blocks).** Gradle restructure, `:engine` uniffi, EngineHost, services, onboarding, keys (NFC/QR), hard blocking (apps + browsers), overrides/pools/popup, schedules/one-shots, tamper guards, VPN DNS (optional), entitlement flavors, Firefox bridge. *Accept:* instrumented tests on API 26/34/36 emulators; manual matrix on a physical device (NFC).

**Phase 4 — Android soft blocks.** Catalog extension + generator, AppFeatureEngine, 5 apps. *Accept:* fixture tests pass for each app; manual verification of each feature on current app versions; library/messaging surfaces verified usable.

---

## 9. Testing strategy
- **Engine (bulk of correctness):** `cargo test -p talysman_engine` — schedule edges (overnight, start==end, DST via offset change, missed events replay), activation with latches/windows/suppression, every row of §3.4 gating table, locked + emergency, pool friction/count/midnight/straddle, override lifecycles + Re-enable all restoration, the §3.2 decision table and worked examples as literal tests, streak arithmetic, emergency count, limits, `from_v5` fixtures, `proptest` for restrictiveness soundness. Port existing `tests/electron/unit/scheduleEngine.test.ts` cases into Rust.
- **Parity:** Vitest runs the same JSON scenario fixtures (`tests/fixtures/engine/*.json`) through `engine-wasm` to prove the TS surface matches.
- **Daemon:** keep `platform_core.rs` judge tests; add dispatch tests for gating/USB paths with a fake `usb`; enforcement single-layer parity snapshot tests (DNS set, nft ruleset text).
- **Extension:** Vitest for layered `site-engine.js` decisions and `rules.js` DNR compile; catalog example tests (existing) extended per layer.
- **Desktop e2e:** Playwright against wasm-backed mock (§8 phase 2 list).
- **Android:** JVM unit tests for `EngineHost` using host-built engine-ffi; Robolectric for `WakeScheduler`/receivers; instrumented tests for BlockActivity flow, override sheet, key verify with a fake reader; `AppFeatureEngine` tests against JSON node-tree fixtures in `src/test/resources`.
- **Commands:** `cargo test --workspace` (in `native/`), `pnpm test`, `pnpm test:electron:e2e`, `pnpm build:extension && pnpm audit:extension`, `./gradlew :blocker:testSideloadDebugUnitTest :blocker:connectedSideloadDebugAndroidTest`.
- Never run prettier (repo rule).

## 10. Risks & open items
- **Accessibility brittleness & Play policy:** view ids change; Play requires an accessibility declaration + video; Device Admin + self-protection may draw scrutiny → keep in `sideload` flavor, feature-flag for `play`.
- **Firefox Android** has no native messaging → loopback bridge (token + origin checks); background throttling may delay state frames — extension caches last state and fails closed on staleness >2 min while a profile is active.
- **NFC UID cloning** → prefer NDEF secret; warn for UID-only tags. QR codes can be photographed — UI advises storing the printout away from the phone.
- **Clock tampering** (Android) → monotonic cross-check + Date&time guard (§4.6).
- **Layer-aware enforcement touches every OS path** → single-layer parity first, then multi-layer.
- **Migration is one-way** → `.bak` + v5 shims for one release.
- **Multi-judge semantics** [DEFAULT 12] on desktop.
- **Scope/size:** premade lists feature-gated out of Android `.so` unless VPN ships.
- **Emergency = everything off** means a user who lost their key cannot make a *targeted* relaxation without a key; they'd use the emergency (everything off), pair a new key (free once nothing is active, DEFAULT 13), edit, and re-enable. Acceptable per answer 22; UI copy should suggest "pair a new key" after an emergency unlock.
- **Open:** real ScreenZen popup screenshot (§1 #21).

## 11. Critical files
- Engine (new): `native/Cargo.toml`, `native/engine/**`, `native/engine-ffi/**`, `native/engine-wasm/**`
- Daemon: `native/common/src/{lib,platform_core,platform_state,policy_match,natmsg_frames,platform_unix_natmsg,constants?}.rs`, `native/{linux,windows,macos}/src/{core,service,schedule(delete),enforce/*}.rs`, `native/protocol/schema.json`
- TS: `packages/shared/src/{protocol,events,profile,policy,schedule,constants}.ts`, `packages/shared/src/generated/`, `packages/shared/src/sites/{types.ts,sites/*,android/*}`, `packages/core/src/{scheduleEngine,restrictiveness}.ts` (delete), `packages/product/src/index.ts`, `scripts/generate-site-catalog.ts`, `scripts/lib/site-catalog.ts`
- Desktop: `apps/desktop/src/main/{index.ts,ipc/*,service/mockService.ts}`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/{pages/*,components/*,store/useFocusStore.ts,lib/bridge.ts}`
- Extension: `apps/extension/src/{background,site-engine,site-content,rules,blocked}.js`, `blocked.html`, `blocked.css`, `manifest.json`
- Android: `apps/android/{settings.gradle.kts,build.gradle.kts,build-logic/**,designsystem/**,engine/**,blocker/**}`, `apps/android/README.md`
- Tests: `tests/fixtures/engine/`, `tests/electron/unit/*`, `tests/electron/e2e/*`, `tests/helpers/mockService.ts`
- Docs: `snorlax-architecture.md` (new §: engine, profiles, overrides), `android-and-overrides-spec.md`

---

## 12. Implementation notes (where the build differs from this spec)

Written after implementing phases 1–4 on the `android-and-overrides` branch.

**Engine and data model**
- `ProfileConfig` is `{ policy, appMode, allowedApps, pools, schedule, oneShots }`. `policy` is the
  existing `Policy` (web rules, blacklisted `apps`, catalog `sites` soft rules), not separate
  `web`/`apps`/`soft` structs. The existing editors, restrictiveness rules and extension all keep
  working unchanged.
- Suppressed window occurrences live in `Overrides.suppressed`, not inside `AllOff`/`Exempt`.
  Turning one profile off with its switch (`setLatch off`) is key-gated and breaks the streak, but
  "Re-enable all" doesn't restore it. Turning profiles off through override (2) is restorable.
- A pool with no friction unlocks as soon as it's requested; with friction, request then confirm.
- The journal records breaking events, emergency unlocks, pool unlocks, latch flips, key
  pairing and the migration marker. Tightening edits and window starts aren't journaled.
- No Cargo workspace: every crate keeps its own `Cargo.lock`, because the NixOS daemon package
  builds `native/linux` against its own lockfile. `native/engine` is a path dependency.
- `regex-lite` instead of `regex` (smaller wasm and Android libraries). The catalog's route
  patterns are all plain ASCII.
- Premade blocklists are behind the engine's `premade` feature. The daemons enable it; wasm and
  Android leave it off.

**Desktop**
- Enforcement backends aren't layer-aware. The engine flattens the active profiles into one
  network policy with `effective::flatten_network`. With one profile active it returns that
  profile's policy unchanged, so enforcement is identical to v5. With several, a host is blocked
  if any profile blocks it; in rare cases where one allow pattern can't express the combination,
  it fails closed. The extension therefore still receives one flat state frame, and
  `SITE_CAPABILITY` stays 3.
- Multi-judge (DEFAULT 12) is simplified: the flat policy carries the first active profile's
  judge that has a judged rule.
- The v5 RPCs are removed apart from `enableFocus`/`disableFocus`/`toggleFocus`, which the tray
  and CLIs use. The desktop app refuses a daemon with any other protocol version anyway.
- One-shot events are free on every plan. Recurring schedule rules keep the existing Pro gate.
- The extension's blocked page relays only `getPopupInfo` and the keyless pool-unlock commands.
  The native hosts enforce that allowlist (`natmsg_frames::relay_request`). "Other options"
  opens `talysman://override`.

**Android**
- QR codes use ZXing core for both generation and scanning, not zxing-cpp.
- Paired keys are salted hashes in an app-private file (`KeyRepository`), not a Keystore-wrapped
  file. The hashes can't be reversed into a secret.
- Firefox bridge: fixed port 47623, and the user types an 8-character pairing code from Settings
  into the extension popup. There is no `talysman://ext-pair` deep link. Only the Firefox build of
  the extension contains the loopback socket, and the extension audit allows exactly that one.
- Facebook and Snapchat are app-only catalog entries (`defineApp`). Every Android screen matcher
  carries a `maxTested` app version and **needs checking on a real device**.

**Not done yet**
- Optional VPN DNS mode.
- Play-flavor account sign-in and entitlement fetch. The Play build applies Free limits.
- Release signing and APK upload.
- A developer-options guard.
- Instrumented and on-device tests. The test emulator on the development machine wouldn't boot,
  so nothing Android-side has run on a device yet. JVM tests cover the Kotlin↔engine boundary
  against a host build.
