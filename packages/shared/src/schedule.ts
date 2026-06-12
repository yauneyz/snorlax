/** Schedule data model (architecture §8). Evaluated by the pure @core/scheduleEngine. */

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface ScheduleWindow {
  id: string;
  days: Weekday[];
  /** "HH:MM" 24h local time, inclusive start. */
  start: string;
  /** "HH:MM" 24h local time, exclusive end. */
  end: string;
  /** Optionally a different policy applies during this window. */
  policyId?: string;
  /** If true, a present USB key cannot disable focus during this window ("no escape"). */
  locked: boolean;
}

export interface Schedule {
  windows: ScheduleWindow[];
}

export const EMPTY_SCHEDULE: Schedule = { windows: [] };
