/**
 * Override pools for one profile (spec §3.6): a group of this profile's blocked sites and apps
 * sharing N keyless unlocks a day, M minutes each, with an optional pause (countdown or
 * breathing) before each unlock. Unlocking one member unlocks the whole pool. An item can be in
 * only one pool. Adding or loosening a pool on a profile that's on (or scheduled) needs the key;
 * removing or tightening one is always free.
 */
import React, { useState } from 'react';
import type { Friction, ItemRef, Policy, Pool } from '@talysman/shared';
import { siteDefinition } from '@talysman/shared';
import { cx } from '../lib/utils.js';
import { Button, Input, Kicker, Select } from './ui/index.js';

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

export function PoolEditor({
  pools,
  policy,
  onSave,
}: {
  pools: Pool[];
  policy: Policy;
  onSave: (pools: Pool[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const candidates = poolableItems(policy);
  const pooled = new Map<string, string>();
  for (const pool of pools) for (const item of pool.items) pooled.set(itemKey(item), pool.id);

  const patch = (id: string, fields: Partial<Pool>) => onSave(pools.map((p) => (p.id === id ? { ...p, ...fields } : p)));

  function addPool() {
    const pool: Pool = { id: `pool-${Date.now().toString(36)}`, name: `Pool ${pools.length + 1}`, ...DEFAULT_POOL };
    setOpenId(pool.id);
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

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <Kicker className="text-[9.5px] tracking-[0.2em]">Unlock pools · {pools.length}</Kicker>
        <span className="text-[11px] text-slate-450">Keyless unlocks you allow yourself each day</span>
        <button
          onClick={addPool}
          disabled={candidates.length === 0}
          className="ml-auto text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-45"
        >
          + New pool
        </button>
      </div>
      {candidates.length === 0 && pools.length === 0 && (
        <p className="mt-2 text-[11.5px] text-slate-450">Block some sites or apps first, then pool them here.</p>
      )}
      <div className="mt-2 flex flex-col gap-1.5">
        {pools.map((pool) => {
          const open = openId === pool.id;
          const frictionSecs = pool.friction.kind === 'none' ? 15 : pool.friction.secs;
          return (
            <div key={pool.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025]">
              <button
                onClick={() => setOpenId(open ? null : pool.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
              >
                <span className="text-[13px] font-semibold text-slate-100">{pool.name}</span>
                <span className="font-mono text-[10.5px] text-slate-400">
                  {pool.unlocksPerDay}× {pool.unlockMinutes} min · {pool.items.length} item{pool.items.length === 1 ? '' : 's'}
                  {pool.friction.kind !== 'none' && ` · ${pool.friction.secs}s ${pool.friction.kind}`}
                </span>
              </button>
              {open && (
                <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
                  <label className="col-span-2">
                    <Kicker className="text-[9.5px]">Name</Kicker>
                    <Input
                      className="mt-1"
                      defaultValue={pool.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== pool.name && patch(pool.id, { name: e.target.value.trim() })}
                      aria-label="Pool name"
                    />
                  </label>
                  <label>
                    <Kicker className="text-[9.5px]">Unlocks per day</Kicker>
                    <Input
                      className="mt-1"
                      type="number"
                      min={0}
                      max={20}
                      value={pool.unlocksPerDay}
                      onChange={(e) => patch(pool.id, { unlocksPerDay: Math.min(20, Math.max(0, Number(e.target.value) || 0)) })}
                      aria-label="Unlocks per day"
                    />
                  </label>
                  <label>
                    <Kicker className="text-[9.5px]">Minutes each</Kicker>
                    <Input
                      className="mt-1"
                      type="number"
                      min={1}
                      max={120}
                      value={pool.unlockMinutes}
                      onChange={(e) => patch(pool.id, { unlockMinutes: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })}
                      aria-label="Minutes per unlock"
                    />
                  </label>
                  <label>
                    <Kicker className="text-[9.5px]">Pause before unlocking</Kicker>
                    <Select
                      className="mt-1"
                      value={pool.friction.kind}
                      onChange={(e) => setFriction(pool, e.target.value as Friction['kind'], frictionSecs)}
                      aria-label="Pause kind"
                    >
                      <option value="none">None</option>
                      <option value="countdown">Countdown</option>
                      <option value="breathing">Breathing</option>
                    </Select>
                  </label>
                  <label>
                    <Kicker className="text-[9.5px]">Seconds</Kicker>
                    <Input
                      className="mt-1"
                      type="number"
                      min={5}
                      max={60}
                      disabled={pool.friction.kind === 'none'}
                      value={frictionSecs}
                      onChange={(e) =>
                        pool.friction.kind !== 'none' && setFriction(pool, pool.friction.kind, Number(e.target.value) || 5)
                      }
                      aria-label="Pause seconds"
                    />
                  </label>
                  <div className="col-span-2">
                    <Kicker className="text-[9.5px]">In this pool</Kicker>
                    <div className="mt-1 flex flex-wrap gap-1.5">
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
                            title={elsewhere ? 'Already in another pool' : undefined}
                            className={cx(
                              'rounded-full border px-2.5 py-1 text-[11.5px] transition disabled:opacity-40',
                              mine ? 'border-signal/40 bg-signal/[0.12] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
                            )}
                          >
                            {itemLabel(item)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button variant="danger" onClick={() => onSave(pools.filter((p) => p.id !== pool.id))}>
                      Delete pool
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
