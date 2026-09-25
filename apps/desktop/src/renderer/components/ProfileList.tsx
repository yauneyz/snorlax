/**
 * Every profile with its own switch (spec §5.5). Several can be on at once; what's enforced is
 * the union. Turning one on is free; turning one off is an override (it needs the key and breaks
 * the streak), so the switch opens the override sheet scoped to that profile.
 */
import React, { useState } from 'react';
import { ErrorCode } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { activationLabel, runCommand } from '../lib/engine.js';
import { cx, profileSummary } from '../lib/utils.js';
import { Modal, ProfileDot } from './ui/index.js';
import { OverrideDialog } from './OverrideDialog.js';

export function ProfileSwitch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cx(
        'relative h-[22px] w-[40px] shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50',
        on ? 'border-ok/50 bg-ok/30' : 'border-white/[0.12] bg-white/[0.06]',
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] block h-4 w-4 rounded-full transition-all',
          on ? 'left-[20px] bg-ok shadow-[0_0_8px_rgb(var(--color-success)/0.6)]' : 'left-[2px] bg-slate-400',
        )}
      />
    </button>
  );
}

export function ProfileList({ onClose }: { onClose: () => void }) {
  const engine = useFocusStore((s) => s.engine);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const aiMode = useFocusStore((s) => s.aiMode);
  const [error, setError] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);

  async function turnOn(profileId: string) {
    setError(null);
    try {
      await runCommand({ type: 'setLatch', profileId, on: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === ErrorCode.NO_PAIRED_KEY ? 'Pair a key before turning on a profile.' : (e as Error).message);
    }
  }

  return (
    <>
      <Modal title="Profiles" onClose={onClose} width={520}>
        <p className="text-[12px] text-slate-400">
          Turn on as many as you like — everything any of them blocks is blocked.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {engine.profiles.map((status) => {
            const { profile, activation } = status;
            const on = activation.active || activation.paused;
            return (
              <div
                key={profile.id}
                className={cx(
                  'flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5',
                  on ? 'border-ok/25 bg-ok/[0.05]' : 'border-white/[0.07] bg-white/[0.025]',
                )}
              >
                <ProfileDot color={profile.color} size={10} glow={activation.active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-slate-100">{profile.name}</span>
                    {engine.defaultProfileId === profile.id && (
                      <span className="font-mono text-[9px] tracking-[0.12em] text-slate-450">DEFAULT</span>
                    )}
                  </div>
                  <div className="truncate text-[11.5px] text-slate-400">
                    {activationLabel(status)} · {profileSummary(profile, aiMode)}
                  </div>
                </div>
                <ProfileSwitch
                  label={`${profile.name} ${on ? 'on' : 'off'}`}
                  on={on}
                  disabled={!on && pairedKeys.length === 0}
                  onChange={() => (on ? setOverrideFor(profile.id) : void turnOn(profile.id))}
                />
              </div>
            );
          })}
        </div>
        {pairedKeys.length === 0 && <p className="mt-3 text-[12px] text-warn">Pair a key to turn profiles on.</p>}
        {error && <p className="mt-3 text-[12px] text-dangerInk">{error}</p>}
      </Modal>
      {overrideFor && <OverrideDialog initialProfileId={overrideFor} onClose={() => setOverrideFor(null)} />}
    </>
  );
}
