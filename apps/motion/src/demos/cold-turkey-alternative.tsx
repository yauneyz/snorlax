import React from 'react';
import { EMERGENCY_LIFETIME_LIMIT } from '@talysman/shared';
import { Points } from '../ui/Cards';
import { Locks } from '../ui/Locks';
import { End, Intro, KeyAway, KeyLeaves, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { COLD_TURKEY_TEXT, COLD_TURKEY_TIMER, KEY } from './locks';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.8, label: 'The urge', text: 'Minute forty. The work goes sideways and you look for the off switch.' },
  { at: 8.6, label: 'The lock', text: 'A lock you can satisfy at the keyboard, one with no exit at all — or a key.' },
  { at: 14.4, label: 'Talysman', text: 'The session started with the key in. Then the key left the room.' },
  { at: 19.4, label: 'Talysman', text: 'Turning it off needs the key. There is nothing to do at the keyboard.' },
  { at: 25.4, label: 'The walk', text: 'Getting it is deliberate, upright, fully conscious effort. The impulse doesn’t last that long.' },
  { at: 31.4, label: 'The exit', text: 'And when you truly need out, there is one.', until: 37.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Cold Turkey alternative">
      <Intro to={4.8} query="cold turkey alternative" answer="Strict blocking where the way out is a walk, not a wait or a wall of text." />
      <Scene from={4.8} to={14.4}>
        <Locks from={4.8} urge={6} outcomeAt={10.6} panels={[COLD_TURKEY_TEXT, COLD_TURKEY_TIMER, KEY]} />
      </Scene>
      <KeyLeaves from={14.4} to={19.4} />
      <Refusal from={19.4} to={25.4} />
      <KeyAway from={25.4} to={31.4} />
      <Scene from={31.4} to={37.4}>
        <Points
          from={31.4}
          title="The emergency exit Cold Turkey doesn’t have"
          points={[
            { label: 'The key', text: 'Plug it in and turn off — any time, no wait.', tone: 'ok' },
            { label: 'A spare key', text: 'Pair a second drive for the day you lose the first.', tone: 'ok' },
            { label: 'Emergency unlocks', text: `${EMERGENCY_LIFETIME_LIMIT} per computer, ever — no key needed.`, tone: 'ok' },
          ]}
        />
      </Scene>
      <End from={37.4} to={41} slug="cold-turkey-alternative" headline="A strict blocker with an emergency exit." />
    </Stage>
  );
}

export const coldTurkeyAlternative: Demo = {
  slug: 'cold-turkey-alternative',
  component: Video,
  duration: 41,
  poster: 12,
  description:
    'Cold Turkey’s random-text and timer locks side by side with Talysman’s USB key, then the key leaving the room, turning focus off refused without it, and the emergency exits Talysman keeps.',
};
