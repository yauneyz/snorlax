/**
 * The three key-gated override paths (spec §3.5):
 *   1. everything off until re-enabled,
 *   2. some things off (whole profiles and/or specific sites and apps) until "Re-enable all",
 *   3. everything off for N minutes.
 * A profile held by a locked window is left alone by all three — only an emergency unlock (which
 * always means "everything off") gets past it. Every path breaks the streak; the service checks
 * the USB key itself.
 */
import React, { useMemo, useState } from 'react';
import type { ItemRef } from '@talysman/shared';
import { siteDefinition } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { formatClock, runCommand } from '../lib/engine.js';
import { cx } from '../lib/utils.js';
import { Button, Kicker, Modal, ProfileDot } from './ui/index.js';
import { StreakBadge } from './StreakBadge.js';
import { EmergencyConfirm } from './EmergencyConfirm.js';

type Path = 'menu' | 'some' | 'pause';

const PAUSE_PRESETS = [10, 30, 60, 120];

function itemKey(item: ItemRef): string {
  switch (item.kind) {
    case 'domain':
      return `domain:${item.domain}`;
    case 'catalog':
      return `catalog:${item.id}`;
    case 'app':
      return `app:${item.app.label}`;
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

export function OverrideDialog({ onClose, initialProfileId }: { onClose: () => void; initialProfileId?: string }) {
  const engine = useFocusStore((s) => s.engine);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const [path, setPath] = useState<Path>(initialProfileId ? 'some' : 'menu');
  const [profiles, setProfiles] = useState<Set<string>>(() => new Set(initialProfileId ? [initialProfileId] : []));
  const [items, setItems] = useState<Set<string>>(() => new Set());
  const [minutes, setMinutes] = useState(30);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const active = engine.profiles.filter((p) => p.activation.active);
  const locked = active.filter((p) => p.activation.lockedUntilMs !== null);
  const unlockedActive = active.filter((p) => p.activation.lockedUntilMs === null);

  // Everything an active profile blocks, as override (2) items.
  const blockedItems = useMemo(() => {
    const out = new Map<string, ItemRef>();
    for (const status of unlockedActive) {
      const policy = status.profile.config.policy;
      for (const domain of policy.blockedDomains) {
        const item: ItemRef = { kind: 'domain', domain };
        out.set(itemKey(item), item);
      }
      for (const id of Object.keys(policy.sites)) {
        const item: ItemRef = { kind: 'catalog', id };
        out.set(itemKey(item), item);
      }
      for (const app of policy.apps) {
        const item: ItemRef = { kind: 'app', app };
        out.set(itemKey(item), item);
      }
    }
    return [...out.values()];
  }, [unlockedActive]);

  async function run(command: Parameters<typeof runCommand>[0]) {
    setBusy(true);
    setError(null);
    try {
      await runCommand(command);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const pauseMinutes = custom ? Number(custom) : minutes;

  return (
    <>
      <Modal title="Turn blocking off" onClose={onClose} width={500}>
        <div className="flex items-center gap-2">
          <StreakBadge streak={engine.streak} />
          <span className={cx('ml-auto font-mono text-[10px] tracking-[0.12em]', keyPresent ? 'text-okInk' : 'text-dangerInk')}>
            {keyPresent ? 'KEY PRESENT' : 'INSERT YOUR KEY'}
          </span>
        </div>

        {locked.length > 0 && (
          <p className="mt-3 rounded-[10px] border border-locked/30 bg-locked/[0.08] px-3 py-2 text-[12px] text-lockedInk">
            {locked.map((p) => p.profile.name).join(', ')} {locked.length === 1 ? 'is' : 'are'} locked until{' '}
            {formatClock(Math.max(...locked.map((p) => p.activation.lockedUntilMs ?? 0)))}. Overrides apply to
            everything else; only an emergency unlock gets past a locked window.
          </p>
        )}

        {path === 'menu' && (
          <div className="mt-4 flex flex-col gap-2">
            <OptionButton
              title="Turn everything off"
              detail="Until you turn it back on. Schedules still start on time."
              disabled={busy || unlockedActive.length === 0}
              onClick={() => void run({ type: 'startOverrideAll' })}
            />
            <OptionButton
              title="Turn off some things…"
              detail="Pick profiles, sites or apps. They stay off until “Re-enable all”."
              disabled={busy || unlockedActive.length === 0}
              onClick={() => setPath('some')}
            />
            <OptionButton
              title="Pause everything for…"
              detail="Blocking comes back on by itself."
              disabled={busy}
              onClick={() => setPath('pause')}
            />
          </div>
        )}

        {path === 'some' && (
          <div className="mt-4">
            <Kicker>Profiles</Kicker>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unlockedActive.map((status) => {
                const on = profiles.has(status.profile.id);
                return (
                  <button
                    key={status.profile.id}
                    onClick={() => toggle(profiles, status.profile.id, setProfiles)}
                    aria-pressed={on}
                    className={cx(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition',
                      on ? 'border-white/25 bg-white/[0.10] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
                    )}
                  >
                    <ProfileDot color={status.profile.color} size={7} />
                    {status.profile.name}
                  </button>
                );
              })}
            </div>
            {blockedItems.length > 0 && (
              <>
                <Kicker className="mt-4 block">Sites and apps</Kicker>
                <div className="mt-1.5 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                  {blockedItems.map((item) => {
                    const key = itemKey(item);
                    const on = items.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggle(items, key, setItems)}
                        aria-pressed={on}
                        className={cx(
                          'rounded-full border px-3 py-1 text-[12px] transition',
                          on ? 'border-white/25 bg-white/[0.10] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
                        )}
                      >
                        {itemLabel(item)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPath('menu')}>
                Back
              </Button>
              <Button
                variant="danger"
                disabled={busy || (profiles.size === 0 && items.size === 0)}
                onClick={() =>
                  void run({
                    type: 'startOverrideExempt',
                    profiles: [...profiles],
                    items: blockedItems.filter((item) => items.has(itemKey(item))),
                  })
                }
              >
                Turn off selected
              </Button>
            </div>
          </div>
        )}

        {path === 'pause' && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-1.5">
              {PAUSE_PRESETS.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMinutes(m);
                    setCustom('');
                  }}
                  aria-pressed={!custom && minutes === m}
                  className={cx(
                    'rounded-full border px-3 py-1 text-[12px] transition',
                    !custom && minutes === m ? 'border-white/25 bg-white/[0.10] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
                  )}
                >
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={720}
                placeholder="Custom min"
                aria-label="Custom minutes"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="w-28 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[12px] text-slate-100 outline-none"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPath('menu')}>
                Back
              </Button>
              <Button
                variant="danger"
                disabled={busy || !(pauseMinutes >= 1 && pauseMinutes <= 720)}
                onClick={() => void run({ type: 'startOverrideTimed', minutes: Math.round(pauseMinutes) })}
              >
                Pause
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-dangerInk">{error}</p>}

        <div className="mt-5 flex items-center border-t border-white/[0.06] pt-3">
          {engine.overridden && (
            <Button variant="ghost" disabled={busy} onClick={() => void run({ type: 'reenableAll' })}>
              Re-enable all
            </Button>
          )}
          <button
            onClick={() => setEmergencyOpen(true)}
            disabled={engine.emergencyLeft === 0}
            className="ml-auto text-[11.5px] text-slate-450 underline-offset-2 hover:text-slate-300 hover:underline disabled:no-underline disabled:opacity-60"
          >
            {engine.emergencyLeft === 0
              ? 'No emergency unlocks left'
              : `No key? Emergency unlock — turns everything off (${engine.emergencyLeft} left)`}
          </button>
        </div>
      </Modal>
      {emergencyOpen && <EmergencyConfirm onClose={() => setEmergencyOpen(false)} onDone={onClose} />}
    </>
  );
}

function OptionButton({ title, detail, onClick, disabled }: { title: string; detail: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left transition hover:border-white/[0.16] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
    >
      <div className="text-[13px] font-semibold text-slate-100">{title}</div>
      <div className="mt-0.5 text-[12px] text-slate-400">{detail}</div>
    </button>
  );
}
