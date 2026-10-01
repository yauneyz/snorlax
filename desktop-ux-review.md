# Talysman desktop experience review

**Reviewed:** September 30, 2026  
**Scope:** Download and first launch, the five-step desktop walkthrough, dashboard, blocklists, schedules, keys, overrides, account and plan entry points, settings, and blocked-app unlock flow.

## What this review is based on

I traced the current React renderer, Electron startup and onboarding state, product limits, the download page, and the existing Electron end-to-end test. The current desktop bundle builds successfully in development mode. A live visual walkthrough was unavailable: Electron exits in this sandbox with `sandbox_host_linux.cc: Operation not permitted`. Findings about behavior are grounded in the implementation; judgments about legibility and perceived complexity should be checked with a few people using an installed build. Existing uncommitted edits were left untouched.

## The central problem

The app has one strong promise: **choose what to block, turn protection on, put the USB key away.** The product currently teaches the hardware and enforcement model before it helps the person create a useful block. A first-time user can finish setup with no sites configured, no verified browser protection, and no clear next action. The dashboard then shows a powerful focus control and operational readouts, but little guidance toward a working setup.

The product can be simpler without removing advanced features. Make the first successful block the organizing goal, keep the key and browser checks visible, and reveal schedules, AI, pools, and detailed overrides when the user needs them.

## Priority findings

Priority means likely impact on first success and trust, not engineering effort. **P0** blocks or misrepresents the core experience; **P1** creates substantial confusion or repeated friction; **P2** is polish or an advanced-flow issue.

| Priority | Finding | Why it matters | Concrete change |
| --- | --- | --- | --- |
| **P0** | The walkthrough never asks for a site to block or allow. Blacklist and whitelist are offered as the first choice, but the next steps are browser extension, key, and finish. The final step refuses to raise the shield with an empty list and sends the user to Blocklists afterward. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx) | The default blacklist path ends in “Finish setup” rather than a first working block. Whitelist has the same gap. | After choosing a mode, ask for the first site or offer a few clearly labeled examples. Show a real-time “This will block…” preview. Let the user finish by testing one configured site. |
| **P0** | “Skip setup” permanently marks onboarding complete, and the production UI has no replay or setup checklist. The replay action is inside the developer-only Settings section. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx), [Settings.tsx](apps/desktop/src/renderer/pages/Settings.tsx), [onboarding.ts](apps/desktop/src/main/onboarding.ts) | Someone who skips one confusing step can land on an empty dashboard with no guided way back. | Save progress by task; treat skip as “remind me later.” Keep a small “Finish setup” card until the core checks pass, with direct actions to add a site, pair a key, and verify a browser. |
| **P0** | Browser verification is only a transient onboarding signal. The walkthrough accepts *any prior heartbeat* for “Continue,” including one that reports it cannot block. A stale healthy heartbeat can still render the status as connected, and the store tracks only one browser contact. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx), [useFocusStore.ts](apps/desktop/src/renderer/store/useFocusStore.ts) | The download page asks for the extension in every browser, but the app cannot show whether each browser is protected now. That weakens trust in a blocker. | Keep a per-browser status with “working / needs permission / not detected / last seen.” Make current blocking health, not historical contact, the success criterion. Surface a persistent repair action on the dashboard. |
| **P0** | The walkthrough can raise the shield while the paired USB drive is still connected. The key step pairs it, then the last screen offers “Raise shield”; no step asks the user to remove and put away the key. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx) | The person may believe they have created friction while the off switch is still plugged in. | After activation, show “Unplug your key to protect this session” and detect removal. Confirm the state changed. Do not describe setup as finished while the key remains mounted unless the user explicitly chooses to finish that way. |
| **P1** | The dashboard's “Turn on focus” button is disabled until a key is paired, but its explanation is plain text rather than a route to Keys. The main screen also has no direct “Add sites” or “Check browser” action. [FocusToggle.tsx](apps/desktop/src/renderer/components/FocusToggle.tsx), [Dashboard.tsx](apps/desktop/src/renderer/pages/Dashboard.tsx) | A new user meets a disabled primary action and must infer where to go from navigation labels. | Keep the primary action enabled as a guided action: “Pair a key to start.” Add one contextual setup card with the next missing step and a direct button. |
| **P1** | The first screen says a physical USB key is “the only way back out,” but the app provides lifetime emergency unlocks, scheduled off events, timed overrides, and keyless unlock pools. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx), [EmergencyConfirm.tsx](apps/desktop/src/renderer/components/EmergencyConfirm.tsx), [OverrideDialog.tsx](apps/desktop/src/renderer/components/OverrideDialog.tsx) | An absolute promise conflicts with actual behavior and can create a trust problem at the moment someone needs help. | Say: “The key is your normal way to turn protection off. Emergency unlocks are limited; schedules and any unlock allowances you set can also change it.” Keep the first screen short and link to details. |
| **P1** | The Blocklists page presents the *mechanism* before the user task: AI filter, hard blocks, soft blocks, premade lists, blocked apps, and unlock groups. Each starts collapsed; the mode control and site input are inside Hard blocks. [Blocklists.tsx](apps/desktop/src/renderer/pages/Blocklists.tsx), [BlocklistSection.tsx](apps/desktop/src/renderer/components/BlocklistSection.tsx) | “I want to block Reddit” requires understanding the taxonomy and opening the right section. The empty default view does not foreground the simplest action. | Lead with “Sites to block” and one input. Put mode under “What happens to other sites?” Move soft blocks, apps, AI, and unlock allowances to clearly named secondary sections. Open the useful section when empty. |
| **P1** | “Blacklist,” “Whitelist,” “Block all,” “Hard blocks,” “Always block,” “Soft blocks,” “profile,” “focus,” “shield,” and “strict mode” all appear across one setup journey. [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx), [Blocklists.tsx](apps/desktop/src/renderer/pages/Blocklists.tsx), [Settings.tsx](apps/desktop/src/renderer/pages/Settings.tsx) | Users have to translate between several vocabularies before they can predict what will happen. | Choose one primary object (“Focus profile”), one state (“Protection on/off”), and plain mode labels (“Block these sites,” “Allow only these sites,” “Block the internet”). Define “soft block” once as “hide distracting parts.” |
| **P1** | The dashboard uses “FOCUSED,” “PAUSED,” and “UNPROTECTED” as its large states, while the sidebar separately displays a mode, and the header shows a red “NO KEY” even when protection is off. [FocusToggle.tsx](apps/desktop/src/renderer/components/FocusToggle.tsx), [App.tsx](apps/desktop/src/renderer/App.tsx) | The red key alarm can look like something is broken before setup; “FOCUSED” does not say which sites or apps are actually blocked. | Use an explicit state sentence: “Protection is on: 3 sites blocked by Work.” Show the key as “Key ready / Key put away / Pair a key” according to context, and distinguish configuration readiness from active protection. |
| **P1** | The browser warning disappears after eight seconds and does not become a persistent health state. [App.tsx](apps/desktop/src/renderer/App.tsx) | Someone can miss a loss of protection, especially if the app was behind other windows. | Keep a persistent banner or status card until repaired or explicitly acknowledged; include the affected browser and one repair path. Reserve transient toasts for completed actions. |
| **P1** | The download page asks users to install the extension before launching the app; the desktop walkthrough asks them to do it again without recognizing that earlier step until a heartbeat arrives. The web account dashboard also repeats a three-step setup list that does not reflect actual desktop progress. [download/page.tsx](apps/web/src/app/%28marketing%29/download/page.tsx), [app/page.tsx](apps/web/src/app/%28app%29/app/page.tsx), [FirstRun.tsx](apps/desktop/src/renderer/components/FirstRun.tsx) | The same task appears on multiple surfaces with no shared progress. A person who already installed the extension may think it failed or that another install is required. | In the desktop app, lead with “Checking your browser extension…” and mark it done if healthy contact exists. Make the web guide clearly informational, or sync progress if an account is present. |
| **P1** | If renderer initialization rejects after the window opens, the app keeps showing “Connecting…”; `init()` is called without an error handler and readiness never becomes true. Earlier main-process bootstrap failure logs the error and quits. [App.tsx](apps/desktop/src/renderer/App.tsx), [useFocusStore.ts](apps/desktop/src/renderer/store/useFocusStore.ts), [index.ts](apps/desktop/src/main/index.ts) | A failed or interrupted setup can look like an endless wait or an app that silently closes. | Show a bounded connection state with the reason, Retry, and a way to open repair guidance. Verify it against a missing or incompatible service on a clean machine. |
| **P1** | The main off action opens three different override paths, and locked schedule windows can remain active after the person chooses a broad “everything off” option. A streak badge appears, but the ordinary override confirmation does not plainly say it will reset the streak. [FocusToggle.tsx](apps/desktop/src/renderer/components/FocusToggle.tsx), [OverrideDialog.tsx](apps/desktop/src/renderer/components/OverrideDialog.tsx), [StreakBadge.tsx](apps/desktop/src/renderer/components/StreakBadge.tsx) | The outcome of “Turn off…” requires reading several details. The consequence is easy to miss. | Show the exact result before the final click: what turns off, what stays locked, when it returns, whether the key is needed, and what happens to the streak. Put the most common choice first. |
| **P1** | The schedule page offers three separate rule systems—recurring blocks, “On at / off at,” and one-time commands—on one screen. New recurring blocks immediately default to weekdays 9–11 and save as soon as created; field edits also save immediately. [Schedule.tsx](apps/desktop/src/renderer/pages/Schedule.tsx) | A new user may create a live future rule before understanding the difference, and there is no explicit review step. | Make “Every weekday, 9–11, protect Work” the primary composer with a review and Save action. Put advanced on/off commands and one-time events behind “More scheduling options.” |
| **P2** | The Plans page disables both purchase buttons until sign-in, then tells the user to go to Account, but offers no direct button. [Plans.tsx](apps/desktop/src/renderer/pages/Plans.tsx) | The upgrade flow makes the user leave the current context and find another page. | Make the main button “Sign in to start Pro” when signed out, preserving the selected monthly or annual plan on return. |
| **P2** | Many controls and explanatory labels use 9–11.5 px text with muted color; important explanations often live in a small “?” tooltip. [ui/index.tsx](apps/desktop/src/renderer/components/ui/index.tsx), [BlocklistSection.tsx](apps/desktop/src/renderer/components/BlocklistSection.tsx), [globals.css](apps/desktop/src/renderer/styles/globals.css) | The interface may feel polished at a glance but require effort to read, especially on scaled displays. This is a code-based visual concern, not a measured accessibility result. | Make task labels and help text comfortably readable. Keep the tiny instrument style for secondary metadata only. Put essential explanations inline rather than behind hover. |
| **P2** | Dialogs provide Escape and backdrop closing, but the shared modal does not manage initial focus, focus trapping, or focus return. [ui/index.tsx](apps/desktop/src/renderer/components/ui/index.tsx) | Keyboard users can lose their place in important key and override flows. | Add focus management to the shared modal and verify keyboard-only setup and override flows. |

## The first-run journey, step by step

### Before first launch

The download page explains the two components and avoids forcing account creation, which is helpful. Its step order and the app's walkthrough overlap: both ask for the extension. On a clean install, the desktop app should detect the existing extension and show that task as complete. If the privileged service fails to install or connect, the user needs an actionable repair state rather than a window that disappears or waits indefinitely.

### 1. Welcome

The current explanation is technically ambitious: privileged service, process killing, reboot persistence, and physical recovery. It communicates seriousness, but asks for trust before the user has seen an actual block. The line about the USB key being the *only* way out is inaccurate. Use a short outcome-led message, followed by “How it works” for the enforcement details.

**Suggested first-screen copy:** “Pick a distraction. Talysman blocks it until you bring back your USB key. You can add schedules and exceptions later.” A second sentence should note limited emergency recovery.

### 2. Choose a blocking mode

The three options describe policy architecture. “Block all” is an extreme choice, while the default “Blacklist” sounds like a list to configure later. Ask first: **“What do you want to block?”** Let the user add a site, then optionally choose “Allow only selected sites” or “Block the whole internet.” Show an example of what stays reachable. The final summary should use the saved policy, not only the onboarding screen's local mode state.

### 3. Install the extension

The handshake animation is useful feedback. The current status model is too coarse for a multi-browser promise and too forgiving of degraded or stale contact. State which browser was detected, whether it can actually block, and what permission is missing. If the person skips, let them continue while showing “Browser protection still needs setup” on the dashboard. A working extension in one browser should not imply that other installed browsers are protected.

### 4. Pair the key

Pairing is reasonably direct and rescanning is visible. The screen uses “no stable serial” and “file marker,” which are implementation details and may sound unsafe. Translate this to “Talysman will save a small identifier on this drive” and offer a short explanation only if needed. After pairing, demonstrate the physical behavior: insert to make changes, remove to lock the off switch. The current step goes straight from pairing to raising the shield.

### 5. Finish

The last screen currently mixes three outcomes: raise the shield, finish because no key, or finish because no list. This makes “READY” visually strong even when no useful block can start. Use an explicit readiness checklist:

- **Sites chosen:** at least one site to block, or a deliberate block-all/allow-only choice.
- **Key paired:** a drive is ready for the normal off action.
- **Browser verified:** the browser used for the test can block, with any skipped browser step clearly pending.

Then run a small confirmation: “Turn protection on,” “Unplug your key,” and “Open your chosen site to see the block page.” If a check is incomplete, the primary action should take the user directly to that check, not close the walkthrough.

## Everyday use

### Dashboard

The large seal is an effective focal point. The four readouts are more like telemetry than next actions: key state, number of profiles, lifetime emergency unlocks, and next schedule change. For a first-time or lightly configured user, the most valuable information is **what is blocked now**, **whether browser protection is healthy**, and **what to do next**. Put emergency unlock count near the off or recovery action; it need not occupy a permanent dashboard slot.

Proposed top-level states:

1. **Setup needed:** “Add your first site” / “Pair a key” / “Connect your browser extension,” each with one direct action.
2. **Ready, off:** “Work will block Reddit and YouTube. Turn protection on.”
3. **On, key connected:** “Protection is on. Unplug your key to make turning it off harder.”
4. **On, key away:** “Protection is on. Work blocks 2 sites. Next change: 5 PM.”
5. **Needs attention:** “Firefox extension cannot block. Fix permissions.” Keep this state visible until resolved.

### Blocklists and profiles

The page supports a rich model, but it currently makes users learn the model first. A useful hierarchy would be:

1. **Block sites** — direct input, current sites, and a clear explanation of subdomains.
2. **Choose what happens to other sites** — allow, block, or AI check when available.
3. **Hide distracting parts** — soft blocks, with supported site examples.
4. **More rules** — premade categories, apps, AI settings, unlock allowances.

Keep the profile picker visible, but make it obvious whether the user is **editing** a profile or **turning it on**. The current profile dropdown contains switching, creating, duplicating, default selection, renaming, and deletion, while a separate switch controls activation. That is capable, but the two concepts need stronger labels. Consider “Editing: Work” above the rules and “Protection: Work is on/off” alongside the switch.

### Schedules and overrides

These are important power features. They should read as human outcomes rather than command types. For a schedule, show a sentence such as “Work turns on Monday–Friday at 9 AM and off at 5 PM,” plus whether it is locked and what the key can do during it. For an override, show a preview sentence before confirmation. A lock that remains active after an “everything off” choice should never be a surprise.

### Account and upgrade

The free product can be used without an account, which is a good low-friction choice. Keep account creation out of first-run setup unless the user chooses a Pro feature. When an upgrade is needed, carry the user's intent through sign-in and checkout rather than making them navigate Account and then return to Plans.

## Recommended experience to build

**One short core path:**

1. “What should Talysman block?” Add one site, with examples and a simple test preview.
2. “Add protection in your browser.” Open the right store and wait for *healthy* contact from that browser; allow “later” with a visible pending item.
3. “Pair a USB key.” Detect and name the drive, explain the off switch in one sentence.
4. “Turn protection on.” Show exactly what will be blocked; then ask the user to unplug the key and verify a blocked page.

The advanced mode choice can live under the first step. Schedules, multiple profiles, AI, app blocking, and unlock pools should be discoverable after the first successful block. The product should remember incomplete tasks and resume at the next useful action.

## Suggested implementation order

1. **Close the first-success gap:** add a site/allow-list step, connect the finish screen to actual readiness, and make post-skip setup recoverable in production.
2. **Make protection health honest:** track extension health per browser, show it beyond onboarding, and distinguish stale contact from a closed browser.
3. **Complete the key ritual:** guide removal after activation and clarify emergency recovery in the copy.
4. **Simplify the default surfaces:** dashboard next-action card, direct site entry, clearer profile/editing labels, and task-first language.
5. **Refine advanced flows:** schedule composer and review, override result previews, direct sign-in from upgrade, readable text, and modal keyboard behavior.

## Success criteria for the redesign

Measure these on a clean install, with both a technical test and a few observed first-time users:

- A user can install, add one site, pair a key, turn protection on, unplug the key, and verify the block without being told where to click.
- Someone who skips a setup step can find and finish it from the dashboard later.
- The app never says “browser connected” when the last known extension cannot block or its contact is stale.
- With multiple browsers, the app makes clear which are protected and which need action.
- Before activating, the user can state what will be blocked and how they can turn it off.
- Before an override or locked schedule change, the user can state what will turn off, what remains active, when protection returns, and whether the streak changes.
- All core setup and recovery actions work with keyboard only and at the minimum supported window size.

## Existing strengths to preserve

- The USB key idea is concrete and memorable; pairing and rescanning are already direct.
- The dashboard has one obvious primary control and live state from the service.
- The extension handshake provides immediate feedback when it works.
- The override system has strong capabilities: timed pauses, selective relief, emergency recovery, and keyless pools.
- Free use without account creation keeps the first run accessible.

The redesign should preserve those capabilities while making the **first useful block** and the **current protection state** unmistakable.
