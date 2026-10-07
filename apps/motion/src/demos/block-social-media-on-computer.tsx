import React from 'react';
import { AppWindow } from '../ui/AppWindow';
import { Browser, Capture, NetworkMessages } from '../ui/Browser';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { typed, useTime } from '../ui/anim';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: '9:00', text: 'The session starts on schedule.' },
  { at: 8, label: '9:20', text: 'X, Instagram and TikTok can be blocked outright…' },
  { at: 11, label: '9:20', text: '…or kept with the feed removed.' },
  { at: 15, label: '10:40', text: 'A recruiter messages. You reply — and there’s nothing else on the page to read.' },
  { at: 20.6, label: '14:15', text: 'Slump. You open Talysman to end it early. Turning off needs the key.' },
  { at: 26.6, label: '14:16', text: 'The key is in the car. You get a coffee and come back to the task.', until: 32.6 },
];

function Video() {
  const t = useTime();
  return (
    <Stage beats={BEATS} eyebrow="Block social media on your computer">
      <Intro to={4.6} query="block social media on computer" answer="Block the feeds, keep the messages — and put the off switch in the car." />
      <Scene from={4.6} to={8}>
        <AppWindow state="scheduledArmed" />
      </Scene>
      <Blocked from={8} to={11} url="x.com" />
      <Scene from={11} to={15}>
        <Browser url="instagram.com" title="Instagram">
          <Capture src="media/browser-instagram-no-feed.png" />
        </Browser>
      </Scene>
      <Scene from={15} to={20.6}>
        <Browser url="linkedin.com/messaging" title="Messaging">
          <NetworkMessages reply={typed('Yes — Thursday at 2 works.', t, 16.6, 16)} />
        </Browser>
      </Scene>
      <Refusal from={20.6} to={26.6} state="scheduledNoKey" />
      <KeyAway from={26.6} to={32.6} keyPlace="In the car" rooms={['Desk', 'Hall', 'Driveway']} distance="Out of the house" />
      <End from={32.6} to={36.2} slug="block-social-media-on-computer" headline="Social media, minus the scroll." />
    </Stage>
  );
}

export const blockSocialMediaOnComputer: Demo = {
  slug: 'block-social-media-on-computer',
  component: Video,
  duration: 36.2,
  poster: 13,
  description:
    'A scheduled Talysman session: X blocked, Instagram with its feed removed, LinkedIn messages still working without the feed, and turning focus off refused while the USB key is in the car.',
};
