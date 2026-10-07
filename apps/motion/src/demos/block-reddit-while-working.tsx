import React from 'react';
import { Browser, Capture } from '../ui/Browser';
import { End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Muscle memory', text: 'Ctrl+T, “r”, Enter. The front page loads — with no posts on it.' },
  { at: 10.4, label: 'Still works', text: 'Search, threads you open directly, messages. The feed is what’s gone.' },
  { at: 14.4, label: 'The off switch', text: 'You open Talysman to end the session. Turning off needs the key.' },
  { at: 20.4, label: 'Back to work', text: 'The key is in your bag in the hall. The impulse is gone before you’d get there.', until: 26.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Block Reddit while working">
      <Intro to={4.6} query="block reddit while working" answer="Hide the feed, keep the threads — and put the off switch in another room." />
      <Scene from={4.6} to={14.4}>
        <Browser url="reddit.com" typeFrom={5} title="Reddit">
          <Capture src="media/browser-reddit-no-feed.png" />
        </Browser>
      </Scene>
      <Refusal from={14.4} to={20.4} />
      <KeyAway from={20.4} to={26.4} keyPlace="Bag in the hall" rooms={['Desk', 'Hall', 'Bedroom']} />
      <End from={26.4} to={30} slug="block-reddit-while-working" headline="Reddit without the feed, until the work is done." />
    </Stage>
  );
}

export const blockRedditWhileWorking: Demo = {
  slug: 'block-reddit-while-working',
  component: Video,
  duration: 30,
  poster: 8,
  description:
    'Reddit’s front page loading with its feed removed by Talysman’s site rule, then turning focus off being refused while the USB key is in a bag in the hall.',
};
