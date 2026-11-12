import React from 'react';
import { Points } from '../ui/Cards';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

// No real adult domains on screen: `.example` is reserved and resolves nowhere.
const BEATS: Beat[] = [
  { at: 4.6, label: '11:52 pm', text: 'A private window, an address typed from memory. The block page.' },
  { at: 8.6, label: '11:53 pm', text: 'A different browser. Blocked below the browser too.' },
  { at: 12.6, label: 'The list', text: 'Over 400,000 adult domains, in every browser, plus anything you add.' },
  { at: 19.6, label: '11:54 pm', text: 'You go to turn the blocker off. It asks for the key. There’s no password box.' },
  { at: 25.6, label: 'The key', text: 'It’s in the car. Shoes, coat, the dark. You don’t go, and the urge passes.', until: 31.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Pornography blocker">
      <Intro to={4.6} query="pornography blocker" answer="A blocker whose off switch is a USB key in another room." />
      <Blocked from={4.6} to={8.6} url="adult-site.example" />
      <Blocked from={8.6} to={12.6} url="another-adult-site.example" platform="mac" />
      <Scene from={12.6} to={19.6}>
        <Points
          from={12.6}
          title="The NSFW list, during focus"
          step={0.8}
          points={[
            { label: 'Private window', text: 'Blocked.', tone: 'no' },
            { label: 'Another browser', text: 'Blocked.', tone: 'no' },
            { label: 'Quit the app', text: 'Still blocked. The service does the blocking.', tone: 'no' },
            { label: 'Reboot', text: 'The block comes back with the computer.', tone: 'no' },
            { label: 'Fetch the key', text: 'The only way to turn it off.', tone: 'ok' },
          ]}
        />
      </Scene>
      <Refusal from={19.6} to={25.6} />
      <KeyAway from={25.6} to={31.6} keyPlace="Glovebox of the car" rooms={['Desk', 'Hall', 'Driveway']} distance="Out of the house" />
      <End from={31.6} to={35.2} slug="pornography-blocker" headline="The off switch is somewhere else." />
    </Stage>
  );
}

export const pornographyBlocker: Demo = {
  slug: 'pornography-blocker',
  component: Video,
  duration: 35.2,
  poster: 22,
  description:
    'Talysman’s block page in a private window and in a second browser, the NSFW list holding against the usual workarounds, turning the blocker off refused without the USB key, and the key in the car.',
};
