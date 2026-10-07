import React from 'react';
import { Locks } from '../ui/Locks';
import { End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { KEY } from './locks';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.8, label: 'The minute', text: 'The same urge, three kinds of lock.' },
  { at: 7.4, label: 'Delay lock', text: 'A 200-character string. You type it, faster than last week.' },
  { at: 10.4, label: 'Hard lock', text: 'Nothing to click. Tomorrow you set 45 minutes instead of three hours.' },
  { at: 13, label: 'Physical key', text: 'The key is downstairs. You’d have to go get it. You don’t.' },
  { at: 16.4, label: 'Physical key', text: 'Turning off needs the key — and the key needs a walk.' },
  { at: 22.4, label: 'Friction', text: 'Not a wall. A door that costs a walk, which is longer than the impulse lasts.', until: 28.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Digital lock vs physical friction">
      <Intro to={4.8} query="hardest website blocker to bypass impulsively" answer="Digital locks are walls or puzzles. Physical friction is a walk." />
      <Scene from={4.8} to={16.4}>
        <Locks
          from={4.8}
          urge={5.6}
          outcomeAt={9.4}
          panels={[
            { title: 'Delay lock', subtitle: 'Type to unlock', kind: 'type', outcome: 'Two minutes later you’re on Reddit.', held: false },
            { title: 'Hard lock', subtitle: 'Timer, no exit', kind: 'timer', outcome: 'It holds — so you stop using it for long blocks.', held: false },
            { ...KEY, title: 'Physical key', subtitle: 'Talysman' },
          ]}
        />
      </Scene>
      <Refusal from={16.4} to={22.4} />
      <KeyAway from={22.4} to={28.4} keyPlace="Downstairs" rooms={['Desk', 'Stairs', 'Downstairs']} />
      <End from={28.4} to={32} slug="digital-lock-vs-physical-friction" headline="An emergency exit without an override button." />
    </Stage>
  );
}

export const digitalLockVsPhysicalFriction: Demo = {
  slug: 'digital-lock-vs-physical-friction',
  component: Video,
  duration: 32,
  poster: 12,
  description:
    'A type-to-unlock delay lock, a hard timer lock and Talysman’s physical USB key meeting the same urge, then Talysman refusing to turn off while the key is downstairs.',
};
