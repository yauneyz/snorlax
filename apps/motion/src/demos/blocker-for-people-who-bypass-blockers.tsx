import React from 'react';
import { Desk } from '../ui/Cards';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const CODE = ['fn reconcile(ledger: &mut Ledger, batch: &[Entry]) -> Result<()> {', '    for entry in batch {', '        ledger.apply(entry)?;'];

const BEATS: Beat[] = [
  { at: 4.6, label: 'The urge', text: 'Forty minutes into something hard, you alt-tab without quite deciding to.' },
  { at: 8.6, label: 'Block page', text: 'So you open the blocker instead. This is where every other blocker loses.' },
  { at: 11.6, label: 'The click', text: 'Turn off is out of reach. The key indicator is red.' },
  { at: 17.6, label: 'The math', text: 'The drive is in the kitchen, where you put it while you were thinking clearly.' },
  { at: 23.6, label: 'The result', text: 'Back to the editor. The impulse cost eleven seconds instead of an hour.', until: 28.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="For people who bypass blockers">
      <Intro to={4.6} query="website blocker if i keep turning it off" answer="Don’t rely on willpower. Rely on the key being in the kitchen." />
      <Scene from={4.6} to={8.6}>
        <Desk kind="code" lines={CODE} typeFrom={4.8} />
      </Scene>
      <Blocked from={8.6} to={11.6} url="reddit.com/r/all" />
      <Refusal from={11.6} to={17.6} />
      <KeyAway from={17.6} to={23.6} />
      <Scene from={23.6} to={28.6}>
        <Desk kind="code" lines={[...CODE, '    }', '    ledger.commit()', '}']} typeFrom={22.9} />
      </Scene>
      <End from={28.6} to={32.2} slug="blocker-for-people-who-bypass-blockers" headline="For people who always find the off switch." />
    </Stage>
  );
}

export const blockerForPeopleWhoBypassBlockers: Demo = {
  slug: 'blocker-for-people-who-bypass-blockers',
  component: Video,
  duration: 32.2,
  poster: 21.5,
  description:
    'Mid-task, a distracting site hits Talysman’s block page, turning focus off is refused with the USB key in the kitchen, and work resumes in the editor.',
};
