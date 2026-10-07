/**
 * The moments most demos share, as scenes with their own timing: the key leaving, the reach for
 * the off switch, a blocked site. Each takes absolute start/end seconds on the demo's timeline.
 */
import React from 'react';
import { c } from '../theme';
import type { StateName } from '../fixtures';
import { AppWindow } from './AppWindow';
import { BlockPage, Browser } from './Browser';
import { Callout, Pointer, Ring } from './Pointer';
import { Scene } from './Stage';
import { EndCard, SearchIntro } from './Cards';
import { Room } from './Room';
import { step, useTime } from './anim';
import type { Platform } from './Window';

/** Focus on with the key in; then the key comes out and the header pill turns red. */
export function KeyLeaves({ from, to, platform, before = 'focused', after = 'focusedNoKey' }: { from: number; to: number; platform?: Platform; before?: StateName; after?: StateName }) {
  const t = useTime();
  const out = from + (to - from) * 0.45;
  return (
    <Scene from={from} to={to}>
      <AppWindow
        platform={platform}
        state={step(t, [
          { at: 0, value: before },
          { at: out, value: after },
        ])}
        targets={['KEY PRESENT', 'NO KEY']}
        overlay={(a) => (
          <>
            <Ring anchor={a['KEY PRESENT']} from={from + 0.8} to={out} color={c.success} />
            <Ring anchor={a['NO KEY']} from={out} to={to} />
            <Callout anchor={a['NO KEY']} text="Key unplugged — blocking holds" from={out + 0.3} to={to} place="below-end" />
          </>
        )}
      />
    </Scene>
  );
}

/**
 * The reach for the off switch: the pointer goes to "Turn off", clicks, and nothing happens —
 * the button is disabled without the key. The callout is the button's own tooltip text.
 */
export function Refusal({ from, to, platform, state = 'focusedNoKey' }: { from: number; to: number; platform?: Platform; state?: StateName }) {
  const click = from + 2.1;
  return (
    <Scene from={from} to={to}>
      <AppWindow
        platform={platform}
        state={state}
        focus="Turn off"
        zoom={[
          { at: from + 1.6, value: 1 },
          { at: from + 2.6, value: 1.4 },
        ]}
        targets={['Turn off', 'NO KEY']}
        overlay={(a) => (
          <>
            <Pointer start={{ x: 900, y: 640 }} anchors={a} keys={[{ at: click - 0.4, to: 'Turn off', travel: 1.2 }, { at: click, to: 'Turn off', click: true, travel: 0.2 }]} />
            <Callout anchor={a['Turn off']} text="Insert your key to turn off the blocker" from={click + 0.4} to={to} />
            <Ring anchor={a['NO KEY']} from={click + 0.8} to={to} />
          </>
        )}
      />
    </Scene>
  );
}

/** A blocked site, typed into the address bar: the extension's block page. */
export function Blocked({ from, to, url, platform }: { from: number; to: number; url: string; platform?: Platform }) {
  return (
    <Scene from={from} to={to}>
      <Browser url={url} typeFrom={from + 0.3} title="Website blocked by Talysman" platform={platform}>
        <BlockPage />
      </Browser>
    </Scene>
  );
}

/** The Keys page: a drive is listed, "Pair this drive", and the header goes green. */
export function PairKey({ from, to, platform }: { from: number; to: number; platform?: Platform }) {
  const t = useTime();
  const click = from + 2.2;
  return (
    <Scene from={from} to={to}>
      <AppWindow
        platform={platform}
        route="keys"
        state={step(t, [
          { at: 0, value: 'unpaired' },
          { at: click + 0.3, value: 'idle' },
        ])}
        targets={['Pair this drive', 'KEY PRESENT', 'SanDisk Ultra (E:)']}
        overlay={(a) => (
          <>
            <Ring anchor={a['SanDisk Ultra (E:)']} from={from + 0.5} to={click} color={c.desktopSignal} pad={6} />
            <Pointer start={{ x: 700, y: 600 }} anchors={a} keys={[{ at: click - 0.3, to: 'Pair this drive', travel: 1.1 }, { at: click, to: 'Pair this drive', click: true, travel: 0.2 }]} hideAfter={click + 0.8} />
            <Ring anchor={a['KEY PRESENT']} from={click + 0.5} to={to} color={c.success} />
            <Callout anchor={a['KEY PRESENT']} text="This drive is now the key" from={click + 0.8} to={to} tone="signal" place="below-end" />
          </>
        )}
      />
    </Scene>
  );
}

/** Dashboard, key in: "Turn on focus" and the seal goes FOCUSED. */
export function TurnOn({ from, to, platform }: { from: number; to: number; platform?: Platform }) {
  const t = useTime();
  const click = from + 1.8;
  return (
    <Scene from={from} to={to}>
      <AppWindow
        platform={platform}
        state={step(t, [
          { at: 0, value: 'idle' },
          { at: click + 0.25, value: 'focused' },
        ])}
        targets={['Turn on focus']}
        overlay={(a) => (
          <Pointer start={{ x: 900, y: 650 }} anchors={a} keys={[{ at: click - 0.3, to: 'Turn on focus', travel: 1.1 }, { at: click, to: 'Turn on focus', click: true, travel: 0.2 }]} hideAfter={click + 0.8} />
        )}
      />
    </Scene>
  );
}

/** The key is back in the port: "Turn off" is live again, and the session ends on purpose. */
export function KeyBack({ from, to, platform }: { from: number; to: number; platform?: Platform }) {
  const t = useTime();
  const click = from + 2.2;
  return (
    <Scene from={from} to={to}>
      <AppWindow
        platform={platform}
        state={step(t, [
          { at: 0, value: 'focusedKeyBack' },
          { at: click + 0.25, value: 'idle' },
        ])}
        targets={['KEY PRESENT', 'Turn off']}
        overlay={(a) => (
          <>
            <Ring anchor={a['KEY PRESENT']} from={from + 0.4} to={to} color={c.success} />
            <Pointer start={{ x: 900, y: 650 }} anchors={a} keys={[{ at: click - 0.3, to: 'Turn off', travel: 1.1 }, { at: click, to: 'Turn off', click: true, travel: 0.2 }]} hideAfter={click + 0.8} />
          </>
        )}
      />
    </Scene>
  );
}

/** Opens every demo: the search, then the one-sentence answer the page gives. */
export function Intro({ to, query, answer }: { to: number; query: string; answer: string }) {
  return (
    <Scene from={0} to={to}>
      <SearchIntro query={query} answer={answer} />
    </Scene>
  );
}

export function End({ from, to, slug, headline }: { from: number; to: number; slug: string; headline: string }) {
  return (
    <Scene from={from} to={to}>
      <EndCard from={from} slug={slug} headline={headline} />
    </Scene>
  );
}

export function KeyAway({ from, to, ...room }: { from: number; to: number } & Omit<React.ComponentProps<typeof Room>, 'from'>) {
  return (
    <Scene from={from} to={to}>
      <Room from={from} {...room} />
    </Scene>
  );
}
