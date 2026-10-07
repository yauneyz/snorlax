/**
 * Every real-UI state the demos use, one per second — a quick visual check after re-recording
 * fixtures or changing the desktop app: `remotion studio`, composition "gallery".
 */
import React from 'react';
import { Sequence } from 'remotion';
import { AppWindow } from './ui/AppWindow';
import { AppClosed } from './ui/Cards';
import { Stage } from './ui/Stage';
import type { StateName } from './fixtures';
import type { Route } from '../../desktop/src/renderer/App';

export const GALLERY: { state: StateName; route?: Route }[] = [
  { state: 'unpaired', route: 'keys' },
  { state: 'idle', route: 'keys' },
  { state: 'idle' },
  { state: 'focused', route: 'blocklists' },
  { state: 'scheduledNoKey' },
  { state: 'scheduledEnded' },
  { state: 'focusedKeyBack' },
];

export function Gallery() {
  return (
    <Stage beats={[]}>
      {GALLERY.map((shot, index) => (
        <Sequence key={index} from={index * 30} durationInFrames={30}>
          <AppWindow state={shot.state} route={shot.route} />
        </Sequence>
      ))}
      <Sequence from={GALLERY.length * 30} durationInFrames={90}>
        <AppClosed name="Discord" launches={[0]} />
      </Sequence>
    </Stage>
  );
}
