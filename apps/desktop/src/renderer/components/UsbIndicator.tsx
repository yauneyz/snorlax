/** The red/green dot. Pure presentational — bound to keyPresent from the store. */
import React from 'react';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx } from '../lib/utils.js';

export function UsbIndicator({ showLabel = true }: { showLabel?: boolean }) {
  const keyPresent = useFocusStore((s) => s.keyPresent);
  return (
    <div className="flex items-center gap-2">
      <span
        className={cx(
          'inline-block h-3 w-3 rounded-full',
          keyPresent ? 'bg-ok shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]' : 'bg-danger shadow-[0_0_8px_2px_rgba(239,68,68,0.5)]',
        )}
      />
      {showLabel && (
        <span className={cx('text-sm font-medium', keyPresent ? 'text-green-400' : 'text-red-400')}>
          {keyPresent ? 'Key present' : 'No key'}
        </span>
      )}
    </div>
  );
}
