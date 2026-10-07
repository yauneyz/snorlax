import React from 'react';
import { Browser, Capture, VideoHome, VideoSearch, VideoWatch } from '../ui/Browser';
import { Desk } from '../ui/Cards';
import { End, Intro, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const CODE = [
  'error[E0597]: `buf` does not live long enough',
  '  --> src/parser.rs:42:17',
  '',
  'fn tokens<\'a>(src: &\'a str) -> Vec<Token<\'a>> {',
];

const BEATS: Beat[] = [
  { at: 4.6, label: 'Stuck', text: 'A borrow-checker error.' },
  { at: 7.6, label: 'Stuck', text: 'You search YouTube and open the explainer. It plays with no sidebar.' },
  { at: 13.6, label: 'Drift', text: 'It ends. You click the logo — no feed. You try Reddit — no front page.' },
  { at: 20.6, label: 'The off switch', text: 'You open Talysman. Turning off needs the key, which is in your bag by the door.' },
  { at: 26.6, label: 'Fixed', text: 'You go back and fix the lifetime.', until: 31 },
];

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Focus app for developers">
      <Intro to={4.6} query="focus app for developers" answer="Keep the docs, the repo and the tutorial. Lose the feeds." />
      <Scene from={4.6} to={7.6}>
        <Desk kind="code" lines={CODE} />
      </Scene>
      <Scene from={7.6} to={10.2}>
        <Browser url="youtube.com/results?search_query=rust+borrow+checker" title="rust borrow checker">
          <VideoSearch query="rust borrow checker lifetimes" />
        </Browser>
      </Scene>
      <Scene from={10.2} to={13.6}>
        <Browser url="youtube.com/watch?v=…" title="rust borrow checker">
          <VideoWatch progress={0.6} />
        </Browser>
      </Scene>
      <Scene from={13.6} to={16.6}>
        <Browser url="youtube.com" title="YouTube">
          <VideoHome />
        </Browser>
      </Scene>
      <Scene from={16.6} to={20.6}>
        <Browser url="reddit.com" typeFrom={16.8} title="Reddit">
          <Capture src="media/browser-reddit-no-feed.png" />
        </Browser>
      </Scene>
      <Refusal from={20.6} to={26.6} />
      <Scene from={26.6} to={31}>
        <Desk kind="code" lines={['fn tokens<\'a>(src: &\'a str) -> Vec<Token<\'a>> {', '    let buf = src.trim();', '    lex(buf).collect()', '}']} typeFrom={26.8} />
      </Scene>
      <End from={31} to={34.6} slug="focus-app-developers" headline="A focus app that leaves your dev tools alone." />
    </Stage>
  );
}

export const focusAppDevelopers: Demo = {
  slug: 'focus-app-developers',
  component: Video,
  duration: 34.6,
  poster: 11.5,
  description:
    'A coding session with Talysman’s site rules: a YouTube tutorial plays without the sidebar, the YouTube home and Reddit front page have no feed, and turning focus off is refused without the USB key.',
};
