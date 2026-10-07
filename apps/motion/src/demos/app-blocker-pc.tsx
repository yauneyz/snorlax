import React from 'react';
import { AppWindow } from '../ui/AppWindow';
import { AppClosed } from '../ui/Cards';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'The list', text: 'Discord, Steam and Slack on the blocklist, next to the sites.' },
  { at: 8.6, label: 'Launch', text: 'You open Discord out of habit. It closes within about a second.' },
  { at: 11.4, label: 'Again', text: 'Again. Closed again. The service watches the process list all session.' },
  { at: 15.6, label: 'The browser', text: 'discord.com in the browser instead. Blocked too.' },
  { at: 18.6, label: 'The off switch', text: 'Turning off needs the key. The key is downstairs.', until: 30.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="App blocker for PC">
      <Intro to={4.6} query="app blocker for pc" answer="Blocked apps close as they open. Ending early needs a USB key." />
      <Scene from={4.6} to={8.6}>
        <AppWindow state="focused" route="blocklists" />
      </Scene>
      <Scene from={8.6} to={15.6}>
        <AppClosed name="Discord" launches={[8.8, 11.4]} />
      </Scene>
      <Blocked from={15.6} to={18.6} url="discord.com" />
      <Refusal from={18.6} to={24.6} />
      <KeyAway from={24.6} to={30.6} keyPlace="Downstairs" rooms={['Desk', 'Stairs', 'Downstairs']} />
      <End from={30.6} to={34.2} slug="app-blocker-pc" headline="Discord and Steam stay closed until the session ends." />
    </Stage>
  );
}

export const appBlockerPc: Demo = {
  slug: 'app-blocker-pc',
  component: Video,
  duration: 34.2,
  poster: 13.5,
  description:
    'Talysman’s blocklist with Discord, Steam and Slack, Discord closing each time it’s opened during focus with the app’s blocked popup, discord.com blocked in the browser, and turning focus off refused without the USB key.',
};
