import React from 'react';
import { AppWindow } from '../ui/AppWindow';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { ramp, useTime } from '../ui/anim';
import { alpha, c, fonts } from '../theme';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Cmd-Q', text: 'You quit Talysman.' },
  { at: 8.4, label: 'Still blocked', text: 'The site is still blocked. The app was never doing the blocking.' },
  { at: 11.6, label: 'Safari', text: 'Another browser. Same block — it isn’t an extension trick.' },
  { at: 14.8, label: 'Turn off', text: 'Turning off needs the key. The indicator is red.' },
  { at: 20.8, label: 'The key', text: 'It’s on the hallway shelf. You go back to work instead.', until: 26.8 },
];

function Quit() {
  const t = useTime();
  const gone = ramp(t, 6.6, 0.5);
  return (
    <>
      <div style={{ opacity: 1 - gone, transform: `scale(${1 - gone * 0.05})`, position: 'absolute', inset: 0 }}>
        <AppWindow platform="mac" state="focusedNoKey" />
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 480,
          transform: 'translateX(-50%)',
          opacity: ramp(t, 5.2, 0.3) * (1 - ramp(t, 7.4, 0.3)),
          padding: '18px 34px',
          borderRadius: 16,
          background: alpha(c.panelRaised, 0.95),
          border: `1px solid ${alpha(c.white, 0.15)}`,
          fontFamily: fonts.mono,
          fontSize: 44,
          color: c.foregroundStrong,
        }}
      >
        ⌘ Q
      </div>
    </>
  );
}

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Website blocker for Mac">
      <Intro to={4.6} query="website blocker mac" answer="Quit the app, switch browsers — it stays blocked until the key comes back." />
      <Scene from={4.6} to={8.4}>
        <Quit />
      </Scene>
      <Blocked from={8.4} to={11.6} url="youtube.com" platform="mac" />
      <Blocked from={11.6} to={14.8} url="x.com" platform="mac" />
      <Refusal from={14.8} to={20.8} platform="mac" />
      <KeyAway from={20.8} to={26.8} keyPlace="Hallway shelf" rooms={['Desk', 'Hallway', 'Kitchen']} />
      <End from={26.8} to={30.4} slug="website-blocker-mac" headline="A Mac blocker that outlives Cmd-Q." />
    </Stage>
  );
}

export const websiteBlockerMac: Demo = {
  slug: 'website-blocker-mac',
  component: Video,
  duration: 30.4,
  poster: 6.2,
  description:
    'On macOS: quitting Talysman leaves sites blocked, another browser hits the same block, and turning focus off needs the USB key on the hallway shelf.',
};
