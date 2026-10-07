import React from 'react';
import { Stage, type Beat } from '../ui/Stage';
import { Blocked, End, Intro, KeyAway, KeyLeaves, PairKey, Refusal, TurnOn } from '../ui/Moments';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Pair', text: 'On a computer, the tap becomes a plug: any USB drive becomes the key.' },
  { at: 9.6, label: 'Start', text: 'Choose what to block and turn on focus.' },
  { at: 12.8, label: 'Unplug', text: 'Take the drive out and put it somewhere that costs you a walk.' },
  { at: 18, label: 'Relapse', text: 'Forty minutes in, the work gets hard. Block page.' },
  { at: 21, label: 'Relapse', text: 'You go to turn it off. No paired key is plugged in, so focus stays on.' },
  { at: 27, label: 'Decide', text: 'Go get the drive — deliberately, on your feet — or go back to work.', until: 33.4 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Brick for computer">
      <Intro to={4.6} query="is there a brick for computer" answer="Yes: Talysman does it with a USB drive instead of a tap." />
      <PairKey from={4.6} to={9.6} />
      <TurnOn from={9.6} to={12.8} />
      <KeyLeaves from={12.8} to={18} />
      <Blocked from={18} to={21} url="x.com" />
      <Refusal from={21} to={27} />
      <KeyAway from={27} to={33.4} keyPlace="Shelf in the next room" rooms={['Desk', 'Hall', 'Living room']} />
      <End from={33.4} to={37} slug="brick-for-computer" headline="Like Brick, but for your computer." />
    </Stage>
  );
}

export const brickForComputer: Demo = {
  slug: 'brick-for-computer',
  component: Video,
  duration: 37,
  poster: 8,
  description:
    'A USB drive is paired as the key, focus is turned on and the drive is unplugged; after a blocked site, turning focus off is refused until the drive is plugged back in.',
};
