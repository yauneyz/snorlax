import React from 'react';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

// No real adult domains on screen: `.example` is reserved and resolves nowhere.
const BEATS: Beat[] = [
  { at: 4.6, label: 'Chrome', text: 'An adult site, typed into Chrome. Talysman’s block page.' },
  { at: 8.6, label: 'Incognito', text: 'A private window, where most extensions are off. Still blocked.' },
  { at: 12.6, label: 'Firefox', text: 'A browser you never set up. Blocked: the service works below every browser.' },
  { at: 16.6, label: 'Turn off', text: 'Turning the blocker off needs the key.' },
  { at: 22.6, label: 'The key', text: 'It’s in a drawer two rooms away.', until: 28.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Adult website blocker">
      <Intro to={4.6} query="block adult websites on chrome" answer="Block them in every browser, and keep the off switch in another room." />
      <Blocked from={4.6} to={8.6} url="adult-site.example" />
      <Blocked from={8.6} to={12.6} url="adult-site.example/incognito" />
      <Blocked from={12.6} to={16.6} url="adult-site.example" platform="linux" />
      <Refusal from={16.6} to={22.6} />
      <KeyAway from={22.6} to={28.6} keyPlace="Desk drawer" rooms={['Desk', 'Hall', 'Study']} />
      <End from={28.6} to={32.2} slug="adult-website-blocker" headline="Every browser. One key." />
    </Stage>
  );
}

export const adultWebsiteBlocker: Demo = {
  slug: 'adult-website-blocker',
  component: Video,
  duration: 32.2,
  poster: 19,
  description:
    'An adult site blocked by Talysman in Chrome, in a private window and in a second browser, then turning the blocker off refused without the USB key, which is in a drawer two rooms away.',
};
