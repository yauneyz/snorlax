import React from 'react';
import { Blocked, End, Intro, KeyAway, KeyBack, Refusal } from '../ui/Moments';
import { Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: '13:30', text: 'Post-lunch slump. You open a news site. Blocked.' },
  { at: 7.6, label: '13:31', text: 'You open Talysman. Turning off needs the key.' },
  { at: 13.6, label: '13:32', text: 'The key is on the hook by the front door. You get water and go back to the doc.' },
  { at: 19.6, label: '17:30', text: 'You fetch the key and end the session. Work is over.', until: 24.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Focus app for remote work">
      <Intro to={4.6} query="focus app for remote workers" answer="At home, the boundary is a key on the hook by the door." />
      <Blocked from={4.6} to={7.6} url="bbc.co.uk/news" />
      <Refusal from={7.6} to={13.6} />
      <KeyAway from={13.6} to={19.6} keyPlace="Hook by the front door" rooms={['Desk', 'Hall', 'Front door']} />
      <KeyBack from={19.6} to={24.6} />
      <End from={24.6} to={28.2} slug="focus-app-remote-work" headline="A physical boundary for working from home." />
    </Stage>
  );
}

export const focusAppRemoteWork: Demo = {
  slug: 'focus-app-remote-work',
  component: Video,
  duration: 28.2,
  poster: 17.5,
  description:
    'Working from home: a news site is blocked, turning focus off is refused while the USB key hangs by the front door, and at 17:30 the key is fetched and the session ends.',
};
