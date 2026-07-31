/**
 * The big on/off control. Enabling requires a paired key; disabling is available when the UI
 * knows a paired key is present. Both actions still route through the authoritative service.
 */
import React, { useState } from 'react';
import { ErrorCode } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx } from '../lib/utils.js';
import { Button } from './ui/index.js';

export function FocusToggle() {
  const focusActive = useFocusStore((s) => s.focusActive);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const scheduleLocked = useFocusStore((s) => s.scheduleLocked);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keyRequired = focusActive && !keyPresent;
  const pairedKeyRequired = !focusActive && pairedKeys.length === 0;
  const toggleUnavailable = busy || keyRequired || pairedKeyRequired;

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
      if (code === ErrorCode.KEY_REQUIRED) setMessage('🔑 Insert your paired key to unlock.');
      else if (code === ErrorCode.NO_PAIRED_KEY) setMessage('Pair a key before turning on focus.');
      else if (code === ErrorCode.LOCKED) setMessage('🔒 A locked schedule window is active — no key can unlock right now.');
      else setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={toggle}
        disabled={toggleUnavailable}
        className={cx(
          'relative flex h-44 w-44 items-center justify-center rounded-full border-4 text-xl font-bold tracking-wide backdrop-blur-sm transition duration-200',
          focusActive
            ? 'border-ok bg-green-500/10 text-green-300 shadow-[0_0_40px_rgba(34,197,94,0.25)]'
            : 'border-white/[0.10] bg-white/[0.04] text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-white/25 hover:bg-white/[0.07] hover:text-white',
          toggleUnavailable && 'cursor-not-allowed opacity-60',
        )}
      >
        {focusActive ? 'FOCUSED' : 'OFF'}
      </button>

      <div className="flex flex-col items-center gap-2">
        <Button
          onClick={toggle}
          disabled={toggleUnavailable}
          variant={keyRequired || pairedKeyRequired ? 'ghost' : focusActive ? 'danger' : 'primary'}
        >
          {focusActive ? 'Turn off focus' : 'Turn on focus'}
        </Button>
        {keyRequired && (
          <p className="text-center text-sm text-slate-400">insert key to turn off focus</p>
        )}
        {pairedKeyRequired && (
          <p className="text-center text-sm text-slate-400">pair a key to turn on focus</p>
        )}
      </div>

      {message && <p className="max-w-xs text-center text-sm text-amber-300">{message}</p>}
      {scheduleLocked && !message && (
        <p className="text-center text-sm text-amber-400">🔒 A locked schedule window is active.</p>
      )}
    </div>
  );
}
