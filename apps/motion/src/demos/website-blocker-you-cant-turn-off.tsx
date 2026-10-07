import React from 'react';
import { Blocked, End, Intro, KeyAway, KeyLeaves, Refusal } from '../ui/Moments';
import { Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: '0:00', text: 'A focus session is running. The key is plugged in.' },
  { at: 7.4, label: '0:02', text: 'You unplug the key and leave it in the kitchen.' },
  { at: 10.6, label: '0:38', text: 'The task turns ambiguous. You alt-tab — block page.' },
  { at: 13.8, label: '0:41', text: 'You go to turn it off. Without the key, you can’t. There is no second button.' },
  { at: 20.4, label: '0:44', text: 'The key is two rooms away, where you put it on purpose.' },
  { at: 24.6, label: '0:52', text: 'You go back to the editor. The urge cost eleven seconds.', until: 27.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="A blocker you can’t turn off">
      <Intro to={4.6} query="website blocker you can't turn off" answer="Ending a session early needs a USB key — and you left it in another room." />
      <KeyLeaves from={4.6} to={10.6} />
      <Blocked from={10.6} to={13.8} url="news.ycombinator.com" />
      <Refusal from={13.8} to={20.4} />
      <KeyAway from={20.4} to={27.4} keyPlace="Kitchen counter" />
      <End from={27.4} to={31} slug="website-blocker-you-cant-turn-off" headline="A blocker you can’t turn off on impulse." />
    </Stage>
  );
}

export const websiteBlockerYouCantTurnOff: Demo = {
  slug: 'website-blocker-you-cant-turn-off',
  component: Video,
  duration: 31,
  poster: 17.5,
  description:
    'A focus session runs in Talysman, the USB key is unplugged and left in the kitchen, a distracting site shows the block page, and turning focus off is unavailable until the key is back.',
};
