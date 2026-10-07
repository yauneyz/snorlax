import type { PopupInfo, ServiceState } from '@talysman/shared';
import recorded from './generated/states.json';

/** Recorded by scripts/fixtures.ts from the mock service and the real engine. */
export const FIXTURES = recorded as unknown as {
  states: Record<StateName, ServiceState>;
  popups: Record<'discord', PopupInfo & { showStreak: boolean }>;
};

export type StateName =
  | 'unpaired'
  | 'idle'
  | 'focused'
  | 'focusedNoKey'
  | 'focusedKeyBack'
  | 'scheduledBefore'
  | 'scheduledArmed'
  | 'scheduledNoKey'
  | 'scheduledEnded';
