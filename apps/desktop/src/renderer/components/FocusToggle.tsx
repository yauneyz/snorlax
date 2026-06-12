/**
 * The big on/off control. Enabling is ungated; disabling routes through the service, which
 * may refuse with KEY_REQUIRED or LOCKED — we surface that as a helpful message rather than
 * trusting any local "key present" flag.
 */
import React, { useState } from 'react';
import { ErrorCode } from '@focuslock/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx } from '../lib/utils.js';
import { Button } from './ui/index.js';

export function FocusToggle() {
  const focusActive = useFocusStore((s) => s.focusActive);
  const scheduleLocked = useFocusStore((s) => s.scheduleLocked);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        disabled={busy}
        className={cx(
          'relative flex h-44 w-44 items-center justify-center rounded-full border-4 text-xl font-bold transition',
          focusActive
            ? 'border-ok bg-green-500/10 text-green-300 shadow-[0_0_40px_rgba(34,197,94,0.25)]'
            : 'border-border bg-panel2 text-slate-300 hover:border-accent',
          busy && 'opacity-60',
        )}
      >
        {focusActive ? 'FOCUSED' : 'OFF'}
      </button>

      <Button onClick={toggle} disabled={busy} variant={focusActive ? 'danger' : 'primary'}>
        {focusActive ? 'Turn off focus' : 'Turn on focus'}
      </Button>

      {message && <p className="max-w-xs text-center text-sm text-amber-300">{message}</p>}
      {scheduleLocked && !message && (
        <p className="text-center text-sm text-amber-400">🔒 A locked schedule window is active.</p>
      )}
    </div>
  );
}
