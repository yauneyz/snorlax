import React from 'react';
import { AppWindow } from '../ui/AppWindow';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: '08:58', text: 'Weekday mornings, 9 to 11, are on the schedule. The key is already in the kitchen.' },
  { at: 8.6, label: '09:00', text: 'The schedule arms focus on its own.' },
  { at: 12, label: '09:41', text: 'The problem gets hard. You reach for the browser — block page.' },
  { at: 15, label: '09:42', text: 'You go to turn it off. Without the key, you can’t.' },
  { at: 21, label: '09:42', text: 'The key is upstairs.' },
  { at: 26, label: '11:00', text: 'The window closes on its own. You got the hard part done.', until: 30.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Deep work blocker">
      <Intro to={4.6} query="deep work blocker" answer="Schedule the deep-work window. Leave the key somewhere it costs a walk." />
      <Scene from={4.6} to={8.6}>
        <AppWindow state="scheduledBefore" />
      </Scene>
      <Scene from={8.6} to={12}>
        <AppWindow state="scheduledArmed" />
      </Scene>
      <Blocked from={12} to={15} url="news.ycombinator.com" />
      <Refusal from={15} to={21} state="scheduledNoKey" />
      <KeyAway from={21} to={26} keyPlace="Upstairs" rooms={['Desk', 'Stairs', 'Upstairs']} />
      <Scene from={26} to={30.6}>
        <AppWindow state="scheduledEnded" />
      </Scene>
      <End from={30.6} to={34.2} slug="deep-work-blocker" headline="A deep-work block you can’t abandon on impulse." />
    </Stage>
  );
}

export const deepWorkBlocker: Demo = {
  slug: 'deep-work-blocker',
  component: Video,
  duration: 34.2,
  poster: 18,
  description:
    'A scheduled 9–11 deep-work window in Talysman: the schedule arms focus, a distracting site is blocked, turning focus off is refused while the USB key is upstairs, and the window ends on its own at 11.',
};
