import type { LockPanel } from '../ui/Locks';

/**
 * Lock panels shared by the comparison demos. Wording follows the comparison tables on the
 * pages, which cite each vendor's docs — change both together.
 */
export const KEY: LockPanel = {
  title: 'Talysman',
  subtitle: 'USB key',
  kind: 'key',
  outcome: 'The key is two rooms away. You finish the paragraph.',
  held: true,
};

export const COLD_TURKEY_TEXT: LockPanel = {
  title: 'Cold Turkey',
  subtitle: 'Random-text lock',
  kind: 'type',
  outcome: 'You type it out — faster than last week.',
  held: false,
};

export const COLD_TURKEY_TIMER: LockPanel = {
  title: 'Cold Turkey',
  subtitle: 'Timer lock',
  kind: 'timer',
  outcome: 'No way out until it expires — so you set it shorter tomorrow.',
  held: false,
};

export const FREEDOM: LockPanel = {
  title: 'Freedom',
  subtitle: 'Locked Mode',
  kind: 'weekly',
  outcome: 'Ended from the web dashboard. Allowed once every 7 days.',
  held: false,
};

export const FOCUSME: LockPanel = {
  title: 'FocusMe',
  subtitle: 'Force Mode',
  kind: 'timer',
  outcome: 'The plan can’t change until it ends — so the next one is shorter.',
  held: false,
};
