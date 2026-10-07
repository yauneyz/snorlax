import React from 'react';
import { Points } from '../ui/Cards';
import { Locks } from '../ui/Locks';
import { End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { COLD_TURKEY_TEXT, FOCUSME, FREEDOM, KEY } from './locks';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.8, label: 'Same urge', text: 'Minute forty of a deep-work block. Four ways it can go.' },
  { at: 10.4, label: 'The trade', text: 'Each strict mode makes you pick: a lock you can satisfy, or one you dread starting.' },
  { at: 15.4, label: 'Which to pick', text: 'All three are good at different things.' },
  { at: 23.4, label: 'Talysman', text: 'The fourth way: turning off needs a key that isn’t on your desk.' },
  { at: 29.4, label: 'Talysman', text: 'So the long block gets started — and finished.', until: 35.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Cold Turkey vs Freedom vs FocusMe">
      <Intro to={4.8} query="cold turkey vs freedom vs focusme" answer="Three strict lock modes, one urge — and a fourth kind of lock." />
      <Scene from={4.8} to={15.4}>
        <Locks from={4.8} urge={6} outcomeAt={10.4} panels={[COLD_TURKEY_TEXT, FREEDOM, FOCUSME, KEY]} />
      </Scene>
      <Scene from={15.4} to={23.4}>
        <Points
          from={15.4}
          title="Honest picks"
          step={0.9}
          points={[
            { label: 'Cold Turkey', text: 'You want a lock with no way out. Windows and Mac.' },
            { label: 'Freedom', text: 'One blocklist across phone, tablet and computer.' },
            { label: 'FocusMe', text: 'Usage limits, detailed schedules, the widest platform list.' },
            { label: 'Talysman', text: 'A strict lock that still has a door — two rooms away.', tone: 'ok' },
          ]}
        />
      </Scene>
      <Refusal from={23.4} to={29.4} />
      <KeyAway from={29.4} to={35.4} />
      <End from={35.4} to={39} slug="cold-turkey-vs-freedom-vs-focusme" headline="The lock you’ll actually keep using." />
    </Stage>
  );
}

export const coldTurkeyVsFreedomVsFocusme: Demo = {
  slug: 'cold-turkey-vs-freedom-vs-focusme',
  component: Video,
  duration: 39,
  poster: 12,
  description:
    'Cold Turkey’s random-text lock, Freedom’s Locked Mode, FocusMe’s Force Mode and Talysman’s USB key meeting the same urge side by side, then which to pick and Talysman’s refusal without the key.',
};
