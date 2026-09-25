import { describe, expect, it } from 'vitest';
import { classifyUrl, ctxAt, Engine, EngineCallError, relaxations } from '@talysman/engine-wasm';
import { emptyProfileConfig, type Command, type ProfileConfig } from '@talysman/shared';

const NOW = Date.UTC(2026, 8, 21, 10, 0); // Monday
const ctx = (offsetMs = 0) => ctxAt(NOW + offsetMs, true);

function config(blocked: string[]): ProfileConfig {
  const c = emptyProfileConfig();
  return { ...c, policy: { ...c.policy, blockedDomains: blocked } };
}

const upsert = (id: string, c: ProfileConfig): Command => ({
  type: 'upsertProfile',
  profile: { id, name: id, color: 'test-color', config: c },
});

describe('engine-wasm', () => {
  it('runs the real engine: tightening is free, loosening an active profile needs the key', () => {
    const engine = Engine.empty('test');
    engine.apply(upsert('a', config(['reddit.com', 'x.com'])), { kind: 'none' }, ctx());
    engine.apply({ type: 'setLatch', profileId: 'a', on: true }, { kind: 'none' }, ctx());
    expect(engine.networkPolicy(ctx()).blockedDomains).toEqual(['reddit.com', 'x.com']);

    const looser = upsert('a', config(['reddit.com']));
    const gate = engine.gate(looser, ctx());
    expect(gate).toEqual({ kind: 'needsKey', relaxations: ['Unblocks x.com'], lockedProfiles: [] });
    expect(() => engine.apply(looser, { kind: 'none' }, ctx())).toThrowError(EngineCallError);
    try {
      engine.apply(looser, { kind: 'none' }, ctx());
    } catch (e) {
      expect((e as EngineCallError).code).toBe('KEY_REQUIRED');
    }
    engine.apply(looser, { kind: 'keyVerified', keyId: 'k' }, ctx());
    const snapshot = engine.snapshot(ctx());
    expect(snapshot.profiles[0]?.activation.active).toBe(true);
    expect(snapshot.emergencyLeft).toBe(5);
    expect(Engine.load(engine.export()).export()).toEqual(engine.export());
  });

  it('exposes popup info, URL classification, and relaxations', () => {
    const engine = Engine.empty('test');
    engine.apply(upsert('a', config(['reddit.com'])), { kind: 'none' }, ctx());
    engine.apply({ type: 'setLatch', profileId: 'a', on: true }, { kind: 'none' }, ctx());
    const popup = engine.popupInfo({ kind: 'url', url: 'https://www.reddit.com/' }, ctx());
    expect(popup.verdict).toEqual({ kind: 'hard' });
    expect(popup.blockingProfiles.map((p) => p.id)).toEqual(['a']);
    expect(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ site: 'youtube', feature: 'content' });
    expect(relaxations(config(['a.com']), config([]), NOW)).toEqual(['Unblocks a.com']);
  });
});
