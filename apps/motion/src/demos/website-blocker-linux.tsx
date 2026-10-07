import React from 'react';
import { Terminal } from '../ui/Terminal';
import { End, Intro, KeyAway, Refusal } from '../ui/Moments';
import { Scene, Stage, type Beat } from '../ui/Stage';
import type { Demo } from './types';

const BEATS: Beat[] = [
  { at: 4.6, label: 'kill', text: 'You kill the service. systemd restarts it a second later (Restart=always).' },
  { at: 11.4, label: 'apt remove', text: 'The pre-removal hook asks the service. Focus is on, no key: removal aborts.' },
  { at: 20.4, label: 'Turn off', text: 'And the off switch checks for your paired USB key.' },
  { at: 26.4, label: 'Root', text: 'You have root — you can still take it apart, on purpose. What’s gone is the ten-second version.', until: 32.4 },
];

const SVC = 'talysman-svc';

function Video() {
  return (
    <Stage beats={BEATS} eyebrow="Website blocker for Linux">
      <Intro to={4.6} query="website blocker for linux hard to bypass" answer="A root systemd service, nftables and DNS below the browser, and a USB key." />
      <Scene from={4.6} to={20.4}>
        <Terminal
          lines={[
            { at: 5, cmd: `sudo pkill ${SVC}` },
            {
              at: 7.2,
              cmd: 'systemctl status talysman --no-pager | head -3',
              out: [
                { text: '● talysman.service - Talysman Enforcement Service', tone: 'plain' },
                { text: '     Loaded: loaded (/etc/systemd/system/talysman.service; enabled)', tone: 'dim' },
                { text: '     Active: active (running) since Tue 2026-10-06 14:41:07 UTC; 1s ago', tone: 'ok' },
              ],
            },
            {
              at: 11.6,
              cmd: 'sudo apt remove talysman',
              delay: 0.8,
              out: [
                { text: 'Removing talysman (0.8.0) ...', tone: 'plain' },
                { text: 'uninstall blocked: focus active and no key present', tone: 'danger' },
                { text: 'dpkg: error processing package talysman (--remove):', tone: 'danger' },
                { text: ' installed talysman package pre-removal script subprocess returned error exit status 10', tone: 'danger' },
                { text: 'E: Sub-process /usr/bin/dpkg returned an error code (1)', tone: 'danger' },
              ],
            },
          ]}
        />
      </Scene>
      <Refusal from={20.4} to={26.4} platform="linux" />
      <KeyAway from={26.4} to={32.4} />
      <End from={32.4} to={36} slug="website-blocker-linux" headline="Strict focus on Debian and Ubuntu." />
    </Stage>
  );
}

export const websiteBlockerLinux: Demo = {
  slug: 'website-blocker-linux',
  component: Video,
  duration: 36,
  poster: 17,
  description:
    'On Linux: killing the Talysman service gets it restarted by systemd, apt remove is aborted by the pre-removal hook during focus without the key, and turning focus off needs the USB key.',
};
