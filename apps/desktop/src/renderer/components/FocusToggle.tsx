/**
 * The seal — the app's one big control. Enabling requires a paired key; disabling is available
 * when the UI knows a paired key is present. Both actions still route through the authoritative
 * service, which re-checks every gate itself.
 */
import React, { useState } from 'react';
import { ErrorCode, palette, resolveActiveProfile } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx, profileSummary } from '../lib/utils.js';
import { Button } from './ui/index.js';
import { TalysmanMark } from './TalysmanMark.js';
import { ProfilePicker } from './ProfilePicker.js';

const RING = 272;

export function FocusToggle() {
  const focusActive = useFocusStore((s) => s.focusActive);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const scheduleLocked = useFocusStore((s) => s.scheduleLocked);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const keyRequired = focusActive && !keyPresent;
  const pairedKeyRequired = !focusActive && pairedKeys.length === 0;
  const toggleUnavailable = busy || keyRequired || pairedKeyRequired;
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  // Switching while enforcing is key-gated at the service; don't offer it without the key.
  const switchLocked = focusActive && !keyPresent;

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (focusActive) {
        await request('disableFocus', {});
      } else {
        await request('enableFocus', { reason: 'user' });
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === ErrorCode.KEY_REQUIRED) setMessage('Insert your paired key to unlock.');
      else if (code === ErrorCode.NO_PAIRED_KEY) setMessage('Pair a key before turning on focus.');
      else if (code === ErrorCode.LOCKED)
        setMessage('A locked schedule window is active — no key can unlock right now.');
      else setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: RING, height: RING }}
      >
        <div
          data-focus-glow
          className={cx(
            'absolute inset-0 rounded-full border',
            focusActive
              ? 'border-ok/40 shadow-[0_0_42px_rgb(var(--color-success)/0.14),inset_0_0_44px_rgb(var(--color-success)/0.06)]'
              : 'border-white/[0.10] shadow-[inset_0_1px_0_rgb(var(--color-white)/0.08)]',
          )}
        />
        <div className="absolute inset-4 rounded-full border border-dashed border-white/[0.06]" />
        <div className="relative flex flex-col items-center gap-1.5">
          <TalysmanMark
            data-focus-glow
            size={46}
            className={cx(
              focusActive
                ? 'drop-shadow-[0_0_16px_rgb(var(--color-success)/0.32)]'
                : 'opacity-75 grayscale-[0.5]',
            )}
          />
          <div
            className="mt-2 text-[25px] font-bold tracking-[-0.025em] text-slate-100"
          >
            {focusActive ? 'FOCUSED' : 'UNPROTECTED'}
          </div>

          <button
            onClick={() => !switchLocked && setPickerOpen(true)}
            disabled={switchLocked}
            className={cx(
              'flex items-center gap-2 rounded-full border px-3 py-1 transition',
              switchLocked
                ? 'cursor-not-allowed border-white/[0.05] bg-transparent'
                : 'border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.09]',
            )}
          >
            <span
              className="block h-[7px] w-[7px] rounded-[2px]"
              style={{ backgroundColor: activeProfile?.color ?? palette.colors.brand }}
            />
            <span className="whitespace-nowrap text-[12.5px] font-semibold text-slate-200">
              {activeProfile?.name ?? 'None'}
            </span>
            <span
              className={cx(
                'font-mono text-[9px] tracking-[0.06em]',
                switchLocked ? 'text-slate-450' : 'text-slate-400',
              )}
            >
              {switchLocked ? 'LOCKED' : 'SWITCH'}
            </span>
          </button>

          <div className="text-[12px] text-slate-400">
            {focusActive && activeProfile ? profileSummary(activeProfile) : 'nothing is being blocked'}
          </div>
        </div>
      </div>

      <div className="mt-[18px] flex flex-col items-center gap-[9px]">
        <Button
          onClick={toggle}
          disabled={toggleUnavailable}
          variant={keyRequired || pairedKeyRequired ? 'ghost' : focusActive ? 'danger' : 'hero'}
          className="rounded-full px-7 py-[11px] text-[13.5px]"
        >
          {focusActive ? 'Turn off focus' : 'Turn on focus'}
        </Button>
        {keyRequired && <p className="text-[12px] text-dangerInk">insert key to turn off focus</p>}
        {pairedKeyRequired && <p className="text-[12px] text-warn">pair a key to turn on focus</p>}
        {message && <p className="max-w-xs text-center text-[12px] text-warn">{message}</p>}
        {scheduleLocked && !message && (
          <p className="text-[12px] text-warn">A locked schedule window is active.</p>
        )}
      </div>

      {pickerOpen && (
        <ProfilePicker
          profiles={profiles}
          activeProfileId={activeProfileId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
