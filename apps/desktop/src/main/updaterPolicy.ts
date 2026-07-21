/** Pure update-install policy kept separate from Electron for deterministic unit tests. */

export interface EnforcementUpdateState {
  focusActive: boolean;
  keyPresent: boolean;
}

export function canRestartForUpdate(state: EnforcementUpdateState): boolean {
  return !state.focusActive || state.keyPresent;
}
