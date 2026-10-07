import React from 'react';
import { Points } from '../ui/Cards';
import { End, Intro, KeyAway, KeyLeaves, PairKey, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.8, label: 'Why', text: 'You don’t disable it because you’re weak. You disable it because the switch is right there.' },
  { at: 10.8, label: 'Pair', text: 'Pair any USB drive. That drive is now the key for this computer.' },
  { at: 15.8, label: 'Unplug', text: 'Start a session, take the drive out, leave it somewhere that costs a walk.' },
  { at: 20.8, label: 'Try to quit', text: 'Forty minutes in you go to turn it off. You can’t — not without the key.' },
  { at: 26.8, label: 'Go back to work', text: 'Or go get the drive, deliberately. What’s gone is the version where you didn’t notice you decided.', until: 33.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Stop disabling your blocker">
      <Intro to={4.8} query="how to stop disabling website blocker" answer="Move the off switch off your desk." />
      <Scene from={4.8} to={10.8}>
        <Points
          from={4.8}
          title="Where a blocker’s off switch usually is"
          step={0.8}
          points={[
            { label: 'Browser extension', text: 'Two clicks: disable, or open another browser.', tone: 'no' },
            { label: 'Desktop app', text: 'Quit it, or end the session.', tone: 'no' },
            { label: 'Locked session', text: 'Wait it out — so you start shorter ones.', tone: 'no' },
            { label: 'Talysman', text: 'A USB key in another room.', tone: 'ok' },
          ]}
        />
      </Scene>
      <PairKey from={10.8} to={15.8} />
      <KeyLeaves from={15.8} to={20.8} />
      <Refusal from={20.8} to={26.8} />
      <KeyAway from={26.8} to={33.4} />
      <End from={33.4} to={37} slug="stop-disabling-website-blocker" headline="Stop disabling your blocker by moving the switch." />
    </Stage>
  );
}

export const stopDisablingWebsiteBlocker: Demo = {
  slug: 'stop-disabling-website-blocker',
  component: Video,
  duration: 37,
  poster: 9.5,
  description:
    'Where a blocker’s off switch usually sits, then pairing a USB drive as Talysman’s key, unplugging it during a session, and turning focus off being refused until it’s back.',
};
