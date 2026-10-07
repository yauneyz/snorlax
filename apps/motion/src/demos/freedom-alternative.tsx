import React from 'react';
import { Points } from '../ui/Cards';
import { Locks } from '../ui/Locks';
import { End, Intro, KeyAway, KeyLeaves, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { FREEDOM, KEY } from './locks';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'You want out', text: 'Forty minutes in, the task turns unpleasant.' },
  { at: 8.4, label: 'Two locks', text: 'Locked Mode’s way out is in software. Talysman’s is a key in another room.' },
  { at: 13.6, label: 'Session running', text: 'Sites and desktop apps blocked. The key leaves the room.' },
  { at: 18.6, label: 'The refusal', text: 'The service checks for a paired drive, finds none, and turning off stays unavailable.' },
  { at: 24.6, label: 'The workarounds', text: 'Each one leaves the session running.' },
  { at: 31.6, label: 'The only door', text: 'Two rooms away, where you put it while you were thinking clearly.', until: 37.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Freedom alternative">
      <Intro to={4.6} query="freedom alternative" answer="Keep the blocking. Move the way out off your desk." />
      <Scene from={4.6} to={13.6}>
        <Locks from={4.6} urge={5.8} outcomeAt={9.8} panels={[FREEDOM, KEY]} />
      </Scene>
      <KeyLeaves from={13.6} to={18.6} />
      <Refusal from={18.6} to={24.6} />
      <Scene from={24.6} to={31.6}>
        <Points
          from={24.6}
          title="Every cheap exit, tried"
          step={0.8}
          points={[
            { label: 'Quit the app', text: 'Nothing changes. The service does the blocking.', tone: 'no' },
            { label: 'Kill the service', text: 'It restarts.', tone: 'no' },
            { label: 'Reboot', text: 'The session comes back.', tone: 'no' },
            { label: 'Uninstall', text: 'Refused on Windows and Linux without the key.', tone: 'no' },
            { label: 'Another browser', text: 'Blocked below the browser too.', tone: 'no' },
          ]}
        />
      </Scene>
      <KeyAway from={31.6} to={37.6} />
      <End from={37.6} to={41.2} slug="freedom-alternative" headline="A session only a physical key can end." />
    </Stage>
  );
}

export const freedomAlternative: Demo = {
  slug: 'freedom-alternative',
  component: Video,
  duration: 41.2,
  poster: 30,
  description:
    'Freedom’s Locked Mode beside Talysman’s USB key, then a Talysman session refusing to turn off without the key, the usual workarounds each leaving the session running, and the key two rooms away.',
};
