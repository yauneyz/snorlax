/**
 * Override pools for one profile (spec §3.6): a group of this profile's blocked sites and apps
 * sharing N keyless unlocks a day, M minutes each, with an optional pause (countdown or
 * breathing) before each unlock. Unlocking one member unlocks the whole pool. An item can be in
 * only one pool. Adding or loosening a pool on a profile that's on (or scheduled) needs the key;
 * removing or tightening one is always free.
 */
import React from 'react';
import type { Friction, ItemRef, Policy, Pool } from '@talysman/shared';
import { siteDefinition } from '@talysman/shared';
import { cx } from '../lib/utils.js';
import { Button, Input } from './ui/index.js';

const DEFAULT_POOL: Omit<Pool, 'id' | 'name'> = { items: [], unlocksPerDay: 3, unlockMinutes: 10, friction: { kind: 'none' } };

function itemKey(item: ItemRef): string {
  switch (item.kind) {
    case 'domain':
      return `domain:${item.domain}`;
    case 'catalog':
      return `catalog:${item.id}`;
    case 'app':
      return `app:${item.app.label}:${item.app.linuxProcessName ?? ''}:${item.app.windowsImageName ?? ''}:${item.app.macBundleId ?? ''}`;
  }
}

function itemLabel(item: ItemRef): string {
  switch (item.kind) {
    case 'domain':
      return item.domain;
    case 'catalog':
      return siteDefinition(item.id)?.label ?? item.id;
    case 'app':
      return item.app.label;
  }
}

/** Everything this profile blocks that a pool could hold. */
export function poolableItems(policy: Policy): ItemRef[] {
  return [
    ...policy.blockedDomains.map((domain): ItemRef => ({ kind: 'domain', domain })),
    ...Object.keys(policy.sites).map((id): ItemRef => ({ kind: 'catalog', id })),
    ...policy.apps.map((app): ItemRef => ({ kind: 'app', app })),
  ];
}

/** "3× 10 min a day" — the collapsed summary of one pool. */
export function poolSummary(pool: Pool): string {
  return `${pool.unlocksPerDay}× ${pool.unlockMinutes} min a day`;
}

/** The shared field look, sized to sit inside a line of text rather than fill a row. */
const INLINE_FIELD =
  'mx-1 inline-block rounded-[8px] border border-white/[0.09] bg-white/[0.035] px-2 py-1 align-middle text-body leading-tight text-white outline-none transition focus:border-white/25 focus:bg-white/[0.06] disabled:opacity-50';

/** A number field sized to sit inside a sentence. */
function InlineNumber({
  value,
  min,
  max,
  label,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
      className={cx(INLINE_FIELD, 'w-[54px] text-center font-mono')}
    />
  );
}

/**
 * Each pool reads as a sentence — "Allow 3 unlocks a day, 10 minutes each, after a 15 second
 * breathing pause" — with the blocked items it covers as chips underneath.
 */
export function PoolEditor({
  pools,
  policy,
  onSave,
}: {
  pools: Pool[];
  policy: Policy;
  onSave: (pools: Pool[]) => void;
}) {
  const candidates = poolableItems(policy);
  const pooled = new Map<string, string>();
  for (const pool of pools) for (const item of pool.items) pooled.set(itemKey(item), pool.id);

  const patch = (id: string, fields: Partial<Pool>) => onSave(pools.map((p) => (p.id === id ? { ...p, ...fields } : p)));

  function addPool() {
    const pool: Pool = { id: `pool-${Date.now().toString(36)}`, name: `Group ${pools.length + 1}`, ...DEFAULT_POOL };
    onSave([...pools, pool]);
  }

  function toggleItem(pool: Pool, item: ItemRef) {
    const key = itemKey(item);
    const has = pool.items.some((i) => itemKey(i) === key);
    patch(pool.id, { items: has ? pool.items.filter((i) => itemKey(i) !== key) : [...pool.items, item] });
  }

  function setFriction(pool: Pool, kind: Friction['kind'], secs: number) {
    const clamped = Math.min(60, Math.max(5, secs));
    patch(pool.id, { friction: kind === 'none' ? { kind: 'none' } : { kind, secs: clamped } });
  }

  if (candidates.length === 0 && pools.length === 0) {
    return (
      <p className="text-caption text-slate-450">
        Block some sites or apps first — then you can give yourself a few keyless unlocks for them here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {pools.map((pool) => {
        const frictionSecs = pool.friction.kind === 'none' ? 15 : pool.friction.secs;
        return (
          <div key={pool.id} className="rounded-[11px] border border-white/[0.08] bg-white/[0.02] p-3.5">
            <div className="flex items-center gap-3">
              <div className="w-[220px]">
                <Input
                  key={`${pool.id}:${pool.name}`}
                defaultValue={pool.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== pool.name && patch(pool.id, { name: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label="Group name"
                  className="py-1.5 font-semibold"
                />
              </div>
              <button
                onClick={() => onSave(pools.filter((p) => p.id !== pool.id))}
                className="ml-auto text-caption font-medium text-slate-500 transition hover:text-dangerInk"
              >
                Delete group
              </button>
            </div>

            <p className="mt-3 text-body leading-[2.4] text-slate-300">
              Allow
              <InlineNumber
                value={pool.unlocksPerDay}
                min={0}
                max={20}
                label="Unlocks per day"
                onChange={(n) => patch(pool.id, { unlocksPerDay: n })}
              />
              unlocks a day,
              <InlineNumber
                value={pool.unlockMinutes}
                min={1}
                max={120}
                label="Minutes per unlock"
                onChange={(n) => patch(pool.id, { unlockMinutes: n })}
              />
              minutes each,{' '}
              {pool.friction.kind === 'none' ? 'with' : 'after a'}
              {pool.friction.kind !== 'none' && (
                <>
                  <InlineNumber
                    value={frictionSecs}
                    min={5}
                    max={60}
                    label="Pause seconds"
                    onChange={(n) => pool.friction.kind !== 'none' && setFriction(pool, pool.friction.kind, n)}
                  />
                  second
                </>
              )}
              <select
                value={pool.friction.kind}
                onChange={(e) => setFriction(pool, e.target.value as Friction['kind'], frictionSecs)}
                aria-label="Pause before unlocking"
                className={cx(INLINE_FIELD, '[&>option]:bg-panel')}
              >
                <option value="none">no pause</option>
                <option value="countdown">countdown</option>
                <option value="breathing">breathing pause</option>
              </select>
              .
            </p>

            <div className="mt-2 text-caption text-slate-450">
              Covers {pool.items.length === 0 ? '— tap the blocked items to include' : `${pool.items.length}`}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {candidates.map((item) => {
                const key = itemKey(item);
                const owner = pooled.get(key);
                const mine = owner === pool.id;
                const elsewhere = owner !== undefined && !mine;
                return (
                  <button
                    key={key}
                    disabled={elsewhere}
                    onClick={() => toggleItem(pool, item)}
                    aria-pressed={mine}
                    title={elsewhere ? 'Already in another group' : undefined}
                    className={cx(
                      'rounded-full border px-2.5 py-1 text-caption transition disabled:opacity-40',
                      mine ? 'border-signal/40 bg-signal/[0.12] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
                    )}
                  >
                    {mine && <span className="mr-1">✓</span>}
                    {itemLabel(item)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <Button variant="ghost" onClick={addPool} className="self-start px-3.5 py-1.5 text-caption">
        + New group
      </Button>
    </div>
  );
}
