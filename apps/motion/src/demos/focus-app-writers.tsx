import React from 'react';
import { Desk } from '../ui/Cards';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const DRAFT = ['The house had been empty for a year before anyone noticed the lights.'];

const BEATS: Beat[] = [
  { at: 4.6, label: 'Stuck', text: 'Third rewrite of the same paragraph. You open a tab.' },
  { at: 8.6, label: 'Blocked', text: 'Block page. You open Talysman to end the session.' },
  { at: 11.6, label: 'The key', text: 'Turning off needs the key. It’s in the kitchen.' },
  { at: 17.6, label: 'The key', text: 'Not worth the walk.' },
  { at: 22.6, label: 'Unstuck', text: 'You stare at the paragraph instead — and then you fix it.', until: 28 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Focus app for writers">
      <Intro to={4.6} query="focus app for writers" answer="Protect the writing session from the tab you open when the sentence won’t come." />
      <Scene from={4.6} to={8.6}>
        <Desk kind="doc" lines={DRAFT} typeFrom={4.8} />
      </Scene>
      <Blocked from={8.6} to={11.6} url="reddit.com/r/writing" />
      <Refusal from={11.6} to={17.6} />
      <KeyAway from={17.6} to={22.6} />
      <Scene from={22.6} to={28}>
        <Desk kind="doc" lines={[...DRAFT, '', 'It was the neighbour’s boy who saw them first, at four in the morning, burning in every room.']} typeFrom={20} />
      </Scene>
      <End from={28} to={31.6} slug="focus-app-writers" headline="Protect your writing sessions." />
    </Stage>
  );
}

export const focusAppWriters: Demo = {
  slug: 'focus-app-writers',
  component: Video,
  duration: 31.6,
  poster: 21,
  description:
    'A stuck writing session: a distracting tab shows Talysman’s block page, turning focus off is refused with the USB key in the kitchen, and the paragraph gets written.',
};
