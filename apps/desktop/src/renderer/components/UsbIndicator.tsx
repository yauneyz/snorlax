/** The key-presence light. Pure presentational — bound to keyPresent from the store. */
import React from 'react';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx } from '../lib/utils.js';

export function UsbIndicator({ showLabel = true }: { showLabel?: boolean }) {
  const keyPresent = useFocusStore((s) => s.keyPresent);
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cx(
          'inline-block h-2.5 w-2.5 rounded-full',
          keyPresent
            ? 'bg-ok shadow-[0_0_10px_2px_rgb(var(--color-success)/0.6)]'
            : 'bg-danger shadow-[0_0_10px_2px_rgb(var(--color-danger)/0.55)]',
        )}
      />
      {showLabel && (
        <span
          className={cx(
            'font-mono text-[10.5px] font-medium tracking-[0.12em]',
            keyPresent ? 'text-okInk' : 'text-dangerInk',
          )}
        >
          {keyPresent ? 'KEY PRESENT' : 'NO KEY'}
        </span>
      )}
    </div>
  );
}
