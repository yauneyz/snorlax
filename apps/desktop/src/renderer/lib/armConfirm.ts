/**
 * The "are you sure?" before arming blocking without the key. A change the engine reports as
 * arming (turning a mode on, tightening an active one, ending a break) can only be undone with the
 * key — so when no key is inserted, a misclick ("block the entire internet") would leave the user
 * stuck until an emergency unlock. `confirmArming` shows `<ArmConfirm />` and resolves with the
 * user's answer.
 */

import { create } from 'zustand';

interface PendingConfirm {
  items: string[];
  resolve: (confirmed: boolean) => void;
}

export const useArmConfirm = create<{ pending: PendingConfirm | null }>(() => ({ pending: null }));

export function confirmArming(items: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    // A second request replaces (and declines) one still on screen.
    useArmConfirm.getState().pending?.resolve(false);
    useArmConfirm.setState({ pending: { items, resolve } });
  });
}

export function answerArming(confirmed: boolean): void {
  const pending = useArmConfirm.getState().pending;
  if (!pending) return;
  useArmConfirm.setState({ pending: null });
  pending.resolve(confirmed);
}
