# Revert note: focus mode green → pink

**Date:** 2026-07-31
**Why it exists:** The focus-active colour was flipped from green to pink purely as a visible
signal for testing the auto-update flow. It is not a design decision. Once the update test is
done, revert it.

There are 4 edits across 4 files. Undo them all and focus mode is green again.

---

## 1. `apps/desktop/tailwind.config.js`

Remove the `focus` token (added under `theme.extend.colors`, just after `ok`):

```diff
         ok: '#22c55e',
-        // The focus-active signal colour. Deliberately distinct from `ok`, which stays
-        // green for generic "this is fine" states (sign-in, entitlement, native service).
-        focus: '#ec4899',
         danger: '#ef4444',
```

## 2. `apps/desktop/src/renderer/components/FocusToggle.tsx` (~line 51)

The big FOCUSED circle — border, fill, text, and glow:

```diff
           focusActive
-            ? 'border-focus bg-pink-500/10 text-pink-300 shadow-[0_0_40px_rgba(236,72,153,0.25)]'
+            ? 'border-ok bg-green-500/10 text-green-300 shadow-[0_0_40px_rgba(34,197,94,0.25)]'
```

## 3. `apps/desktop/src/renderer/components/ui/index.tsx` (~line 44)

Remove the `focus` badge tone and drop it from the `tone` union:

```diff
-export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'focus' | 'danger' | 'neutral' }) {
+export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'danger' | 'neutral' }) {
   const tones = {
     ok: 'bg-green-500/15 text-green-400 border-green-500/30',
-    focus: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
     danger: 'bg-red-500/15 text-red-400 border-red-500/30',
```

## 4. `apps/desktop/src/renderer/pages/Dashboard.tsx` (~line 38)

The "Focus: active" badge goes back to the shared `ok` tone:

```diff
-              Focus: <Badge tone={focusActive ? 'focus' : 'neutral'}>{focusActive ? 'active' : 'off'}</Badge>
+              Focus: <Badge tone={focusActive ? 'ok' : 'neutral'}>{focusActive ? 'active' : 'off'}</Badge>
```

Do #3 and #4 together — removing the `focus` tone without fixing Dashboard is a type error.

---

## What was deliberately NOT changed

Leave these alone; they were never part of the pink change and reverting does not involve them.

- **`ok: '#22c55e'` in the tailwind config** stays green. It is a generic "this is fine" colour
  used by sign-in status, entitlement, and the native-service badge (`Account.tsx`,
  `Settings.tsx`, `Plans.tsx`). Recolouring it would have turned those pink too. This is the
  only reason a separate `focus` token exists at all — if you'd rather not carry the extra
  token long-term, revert as above and focus mode goes back to sharing `ok`.
- **Tray icons** (`tray-green.png` / `tray-red.png`, `apps/desktop/src/main/tray.ts`) track USB
  key presence, not focus state.
- **The "Turn off focus" button** in `FocusToggle.tsx` still uses the `danger` red variant when
  focus is active.

## Verifying the revert

```
npx tsc -p apps/desktop/tsconfig.json --noEmit
```

was clean after the pink change and should be clean after the revert. Then run the app, turn
focus on, and confirm the big circle and the dashboard badge are green.

Delete this file once the revert is done.
