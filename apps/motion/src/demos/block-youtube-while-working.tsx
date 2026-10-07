import React from 'react';
import { Browser, VideoHome, VideoSearch, VideoWatch } from '../ui/Browser';
import { End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import { track, useTime } from '../ui/anim';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'Search', text: 'You search “rust lifetimes explained”. Results load.' },
  { at: 8.6, label: 'The video', text: 'It plays — no sidebar of related videos beside it.' },
  { at: 12.6, label: 'The end', text: 'No autoplay wall when it ends.' },
  { at: 15.6, label: 'The homepage', text: 'You click the logo out of habit. The feed isn’t there. Nothing to scroll.' },
  { at: 19.6, label: 'The urge', text: 'Loosening the rule, like ending the session, needs the key.' },
  { at: 25.6, label: 'Back to work', text: 'The drive is in the kitchen. You write the code the video was for.', until: 31.6 },
];

function Video() {
  const t = useTime();
  return (
    <Stage beats={BEATS} eyebrow="Block YouTube while working">
      <Intro to={4.6} query="block youtube while working" answer="Keep search and the video you came for. Lose the feed and the rabbit hole." />
      <Scene from={4.6} to={8.6}>
        <Browser url="youtube.com/results?search_query=rust+lifetimes+explained" title="rust lifetimes explained">
          <VideoSearch query="rust lifetimes explained" />
        </Browser>
      </Scene>
      <Scene from={8.6} to={15.6}>
        <Browser url="youtube.com/watch?v=…" title="rust lifetimes explained">
          <VideoWatch
            progress={track(t, [
              { at: 8.6, value: 0.2 },
              { at: 12.4, value: 1 },
            ])}
            ended={t > 12.6}
          />
        </Browser>
      </Scene>
      <Scene from={15.6} to={19.6}>
        <Browser url="youtube.com" title="YouTube">
          <VideoHome />
        </Browser>
      </Scene>
      <Refusal from={19.6} to={25.6} />
      <KeyAway from={25.6} to={31.6} />
      <End from={31.6} to={35.2} slug="block-youtube-while-working" headline="YouTube for the tutorial, not the afternoon." />
    </Stage>
  );
}

export const blockYoutubeWhileWorking: Demo = {
  slug: 'block-youtube-while-working',
  component: Video,
  duration: 35.2,
  poster: 11,
  description:
    'A schematic of YouTube under Talysman’s site rules: search and the video work, the sidebar, end-screen wall and home feed are hidden, and loosening the rule is refused without the USB key.',
};
