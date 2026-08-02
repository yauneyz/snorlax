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
          'inline-block h-2.5 w-2.5 animate-pulse rounded-full',
          keyPresent
            ? 'bg-seal shadow-[0_0_10px_2px_rgba(79,214,192,0.6)]'
            : 'bg-danger shadow-[0_0_10px_2px_rgba(255,107,107,0.55)]',
        )}
      />
      {showLabel && (
        <span
          className={cx(
            'font-mono text-[10.5px] font-medium tracking-[0.12em]',
            keyPresent ? 'text-sealInk' : 'text-dangerInk',
          )}
        >
          {keyPresent ? 'KEY PRESENT' : 'NO KEY'}
        </span>
      )}
    </div>
  );
}
