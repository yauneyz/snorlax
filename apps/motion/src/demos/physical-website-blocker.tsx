import React from 'react';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { AppWindow } from '../ui/AppWindow';
import { Blocked, End, Intro, KeyAway, KeyBack, KeyLeaves, PairKey, Refusal, TurnOn } from '../ui/Moments';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.4, label: 'Pair', text: 'Plug in any USB drive and pair it. It’s now the key for this computer.' },
  { at: 9.4, label: 'Block', text: 'Add the sites and apps that take your afternoons.' },
  { at: 13.2, label: 'Start', text: 'Turn on focus.' },
  { at: 16.4, label: 'Unplug', text: 'Take the key out and leave it somewhere inconvenient. This step does the work.' },
  { at: 21.6, label: 'Try to quit', text: 'Blocked site. You go to turn it off — the service finds no key and declines.' },
  { at: 30.6, label: 'The walk', text: 'The key is downstairs. There’s no override button, because an override is just a slower button.' },
  { at: 37, label: 'Come back', text: 'Fetch the key on purpose, and turning off works again.', until: 42 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Physical website blocker">
      <Intro to={4.4} query="physical website blocker" answer="A blocker whose off switch is a USB key you keep in another room." />
      <PairKey from={4.4} to={9.4} />
      <Scene from={9.4} to={13.2}>
        <AppWindow state="idle" route="blocklists" />
      </Scene>
      <TurnOn from={13.2} to={16.4} />
      <KeyLeaves from={16.4} to={21.6} />
      <Blocked from={21.6} to={24.6} url="instagram.com" />
      <Refusal from={24.6} to={30.6} />
      <KeyAway from={30.6} to={37} keyPlace="Downstairs" rooms={['Desk', 'Stairs', 'Downstairs']} />
      <KeyBack from={37} to={42} />
      <End from={42} to={45.5} slug="physical-website-blocker" headline="The off switch is a key in another room." />
    </Stage>
  );
}

export const physicalWebsiteBlocker: Demo = {
  slug: 'physical-website-blocker',
  component: Video,
  duration: 45.5,
  poster: 34,
  description:
    'A USB drive is paired as a key in Talysman, focus is turned on, the key is unplugged, a blocked site shows the block page, turning focus off is refused without the key, and it works again once the key is back.',
};
