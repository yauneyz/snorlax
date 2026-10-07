import React from 'react';
import { Locks } from '../ui/Locks';
import { End, Intro, KeyAway, KeyLeaves, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { FOCUSME, KEY } from './locks';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'The urge', text: 'The task stalls. You go looking for the off switch.' },
  { at: 8.4, label: 'Force Mode', text: 'There isn’t one — the plan runs until it ends. Which is also why you’ll set a shorter one tomorrow.' },
  { at: 13.6, label: 'Talysman', text: 'The session started with the key in. The key is on a shelf in the hallway now.' },
  { at: 18.6, label: 'Talysman', text: 'Turning off needs the key. The indicator is red.' },
  { at: 24.6, label: 'The decision', text: 'Getting up turns an impulse into a decision. Most impulses don’t survive that.', until: 30.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="FocusMe alternative">
      <Intro to={4.6} query="focusme alternative" answer="Not a plan you can’t change — a session you can end, if you fetch the key." />
      <Scene from={4.6} to={13.6}>
        <Locks from={4.6} urge={5.8} outcomeAt={9.8} panels={[FOCUSME, KEY]} />
      </Scene>
      <KeyLeaves from={13.6} to={18.6} />
      <Refusal from={18.6} to={24.6} />
      <KeyAway from={24.6} to={30.6} keyPlace="Hallway shelf" rooms={['Desk', 'Hallway', 'Kitchen']} />
      <End from={30.6} to={34.2} slug="focusme-alternative" headline="Strict, with a way out that costs a walk." />
    </Stage>
  );
}

export const focusmeAlternative: Demo = {
  slug: 'focusme-alternative',
  component: Video,
  duration: 34.2,
  poster: 12,
  description:
    'FocusMe’s Force Mode beside Talysman’s USB key, then a Talysman session that can’t be turned off while the key sits on a hallway shelf.',
};
