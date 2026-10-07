import React from 'react';
import { MessageBox, Restart, TaskManager, UNINSTALL_REFUSAL } from '../ui/Dialogs';
import { AppWindow } from '../ui/AppWindow';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Ctrl+Shift+Esc', text: 'You end Talysman in Task Manager. The enforcement service keeps running.' },
  { at: 10.6, label: 'Still blocked', text: 'The block page is still there.' },
  { at: 13.6, label: 'Restart', text: 'Windows boots, the service starts, focus is still on.' },
  { at: 18.6, label: 'Settings → Apps', text: 'You try to uninstall. Focus is active and no key is present.' },
  { at: 23.6, label: 'End session', text: 'Turning off needs the key.' },
  { at: 29.6, label: 'The key', text: 'It’s in a drawer two rooms away. Three minutes of workarounds later, the urge has worn off.', until: 35.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Website blocker for Windows">
      <Intro to={4.6} query="website blocker windows" answer="A Windows service blocks; only your USB key turns it off early." />
      <Scene from={4.6} to={10.6}>
        <TaskManager selectAt={6.2} endAt={7.6} />
      </Scene>
      <Blocked from={10.6} to={13.6} url="reddit.com/r/all" />
      <Scene from={13.6} to={18.6}>
        <AppWindow state="focusedNoKey" />
        <Restart from={13.6} to={15.6} />
      </Scene>
      <Scene from={18.6} to={23.6}>
        <MessageBox title="Talysman Uninstall" lines={UNINSTALL_REFUSAL} from={19.2} />
      </Scene>
      <Refusal from={23.6} to={29.6} />
      <KeyAway from={29.6} to={35.6} keyPlace="Desk drawer" rooms={['Desk', 'Hall', 'Study']} />
      <End from={35.6} to={39.2} slug="website-blocker-windows" headline="Task Manager, restart, uninstall: all refused." />
    </Stage>
  );
}

export const websiteBlockerWindows: Demo = {
  slug: 'website-blocker-windows',
  component: Video,
  duration: 39.2,
  poster: 20.5,
  description:
    'On Windows: ending Talysman in Task Manager leaves its enforcement service running, a restart brings focus back, the uninstaller refuses without the key, and turning focus off needs the USB key.',
};
