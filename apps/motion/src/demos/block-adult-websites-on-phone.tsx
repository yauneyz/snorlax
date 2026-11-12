import React from 'react';
import { Points } from '../ui/Cards';
import { Blocked, End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

// Talysman has no phone app, so the phone half is told as settings, not shown as Talysman UI.
const BEATS: Beat[] = [
  { at: 4.6, label: 'Phone', text: 'Private DNS on Android, or Screen Time on iPhone. Someone else holds the passcode.' },
  { at: 12.6, label: 'Laptop, late', text: 'The urge moves to the computer. Blocked in every browser.' },
  { at: 16.6, label: 'Turn off', text: 'Turning the blocker off needs the USB key.' },
  { at: 22.6, label: 'The key', text: 'It’s with the person who set your phone passcode.', until: 28.6 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Block adult websites on your phone">
      <Intro to={4.6} query="how to block adult websites on my phone" answer="Two free phone settings, then the same idea for your computer." />
      <Scene from={4.6} to={12.6}>
        <Points
          from={4.6}
          title="The phone, in two minutes"
          step={0.9}
          points={[
            { label: 'Android', text: 'Private DNS → family.cloudflare-dns.com', tone: 'ok' },
            { label: 'iPhone', text: 'Screen Time → Limit Adult Websites', tone: 'ok' },
            { label: 'Google', text: 'SafeSearch → Filter', tone: 'ok' },
            { label: 'The passcode', text: 'Set by someone else, so you can’t switch it off', tone: 'plain' },
          ]}
        />
      </Scene>
      <Blocked from={12.6} to={16.6} url="adult-site.example" />
      <Refusal from={16.6} to={22.6} />
      <KeyAway from={22.6} to={28.6} keyPlace="With a friend" rooms={['Desk', 'Front door', 'Across town']} distance="Not in the house" />
      <End from={28.6} to={32.2} slug="block-adult-websites-on-phone" headline="Phone settings for the phone. A key for the computer." />
    </Stage>
  );
}

export const blockAdultWebsitesOnPhone: Demo = {
  slug: 'block-adult-websites-on-phone',
  component: Video,
  duration: 32.2,
  poster: 8,
  description:
    'The free phone settings that block adult sites (Android Private DNS, iPhone Screen Time, SafeSearch), then on the computer an adult site blocked by Talysman and turning the blocker off refused while the USB key is with a friend.',
};
