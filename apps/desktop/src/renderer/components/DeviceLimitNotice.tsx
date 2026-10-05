import React from 'react';
import { DEVICE_LIMIT_STATUS, PRO_DEVICE_LIMIT } from '@talysman/product';
import { Button } from './ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { openExternal } from '../lib/bridge.js';

const ACCOUNT_PAGE = 'https://www.talysman.app/account';

/**
 * Shown when the account has Pro but this computer is over PRO_DEVICE_LIMIT, so the server
 * answered Free. Without it, a paying user would just see "Free" and assume billing broke.
 */
export function DeviceLimitNotice() {
  const status = useFocusStore((s) => s.entitlementStatus);
  const refreshEntitlement = useFocusStore((s) => s.refreshEntitlement);
  if (status !== DEVICE_LIMIT_STATUS) return null;

  return (
    <div className="rounded-[14px] border border-warn/30 bg-warn/[0.06] p-4 text-body text-slate-250">
      <p className="font-semibold text-warn">Pro is already on {PRO_DEVICE_LIMIT} computers</p>
      <p className="mt-1 text-slate-400">
        Your account&apos;s Pro is in use on {PRO_DEVICE_LIMIT} other computers, so this one is on
        Free. Remove one you no longer use from your account page, then check again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void openExternal(ACCOUNT_PAGE)}>Manage computers</Button>
        <Button variant="ghost" onClick={() => void refreshEntitlement({ fresh: true })}>
          Check again
        </Button>
      </div>
    </div>
  );
}
