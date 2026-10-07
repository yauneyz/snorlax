import React from 'react';
import { Points } from '../ui/Cards';
import { End, Intro, KeyBack, KeyLeaves, PairKey, Refusal, TurnOn } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Plugged in', text: 'Pick the drive from the list and pair it. The indicator goes green.' },
  { at: 9.6, label: 'The drive', text: 'Any USB drive works. Nothing about it changes.' },
  { at: 16.6, label: 'Session starts', text: 'Blocking is handed to a background service that outranks the app.' },
  { at: 19.8, label: 'Unplugged', text: 'The indicator goes red. Blocked stays blocked.' },
  { at: 24.8, label: 'End early?', text: 'The service looks for a paired drive. There isn’t one, so the answer is no.' },
  { at: 30.8, label: 'Plugged back in', text: 'Green again, and you can turn it off. The check is live every time.', until: 35.8 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Turn a USB drive into a blocker">
      <Intro to={4.6} query="turn a usb drive into a distraction blocker" answer="Pair any drive. Without it plugged in, focus can’t be turned off." />
      <PairKey from={4.6} to={9.6} />
      <Scene from={9.6} to={16.6}>
        <Points
          from={9.6}
          title="What the drive is — and isn’t"
          step={0.8}
          points={[
            { label: 'Identified by', text: 'The serial or volume ID it already reports.', tone: 'ok' },
            { label: 'Written to it', text: 'Normally nothing. Keep using it for files.', tone: 'ok' },
            { label: 'Which drive', text: 'Any USB drive. Pair a spare too.', tone: 'ok' },
            { label: 'Holds the session', text: 'No — the service does. The drive is only checked for.', tone: 'plain' },
          ]}
        />
      </Scene>
      <TurnOn from={16.6} to={19.8} />
      <KeyLeaves from={19.8} to={24.8} />
      <Refusal from={24.8} to={30.8} />
      <KeyBack from={30.8} to={35.8} />
      <End from={35.8} to={39.4} slug="turn-a-usb-drive-into-a-distraction-blocker" headline="The drive in your drawer is now a focus key." />
    </Stage>
  );
}

export const turnAUsbDriveIntoADistractionBlocker: Demo = {
  slug: 'turn-a-usb-drive-into-a-distraction-blocker',
  component: Video,
  duration: 39.4,
  poster: 7.5,
  description:
    'Pairing an ordinary USB drive as a Talysman key, what the drive is and isn’t, then a session that can’t be turned off while it’s unplugged and can once it’s plugged back in.',
};
