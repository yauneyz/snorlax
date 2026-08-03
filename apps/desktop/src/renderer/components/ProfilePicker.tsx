/**
 * The radial profile switcher. Profiles sit on a dial around a hub; picking one asks the
 * service to make it active. The service is the authority on whether that's allowed — a
 * switch that loosens blocking while focus is on comes back as KEY_REQUIRED.
 */
import React from 'react';
import type { Profile } from '@talysman/shared';
import { ErrorCode } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx, profileSummary } from '../lib/utils.js';

const BOX = 390;
const NODE = 112;
const ORBIT = 132;

export function ProfilePicker({
  profiles,
  activeProfileId,
  onClose,
}: {
  profiles: Profile[];
  activeProfileId: string;
  onClose: () => void;
}) {
  const refresh = useFocusStore((s) => s.refresh);
  const [error, setError] = React.useState<string | null>(null);

  async function activate(profileId: string) {
    setError(null);
    try {
      await request('setActiveProfile', { profileId });
      await refresh();
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === ErrorCode.KEY_REQUIRED) setError('Insert your paired key to switch profiles.');
      else if (code === ErrorCode.LOCKED) setError('A locked schedule window is holding this profile.');
      else setError((e as Error).message);
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Switch profile">
      <button
        aria-label="Close profile switcher"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(8,9,10,0.90)] backdrop-blur-md"
      />
      <div className="relative" style={{ width: BOX, height: BOX }}>
        <div className="absolute inset-[60px] rounded-full border border-dashed border-white/[0.08]" />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(199,204,212,0.07),transparent_68%)]" />

        {profiles.map((p, i) => {
          const angle = (i / profiles.length) * Math.PI * 2 - Math.PI / 2;
          const on = p.id === activeProfileId;
          return (
            <button
              key={p.id}
              onClick={() => void activate(p.id)}
              className={cx(
                'absolute flex flex-col items-center justify-center gap-1.5 rounded-full border p-2 text-center transition',
                on
                  ? 'border-white/20 bg-white/[0.07] shadow-[0_0_26px_rgba(199,204,212,0.18)]'
                  : 'border-white/[0.09] bg-[rgba(14,15,17,0.9)] shadow-[0_8px_24px_rgba(0,0,0,0.6)] hover:border-white/20 hover:bg-white/[0.05]',
              )}
              style={{
                width: NODE,
                height: NODE,
                left: BOX / 2 + Math.cos(angle) * ORBIT - NODE / 2,
                top: BOX / 2 + Math.sin(angle) * ORBIT - NODE / 2,
              }}
            >
              <span
                className="block h-[11px] w-[11px] rounded-[3px]"
                style={{
                  backgroundColor: p.color,
                  ...(on ? { boxShadow: `0 0 10px 2px ${p.color}` } : {}),
                }}
              />
              <span
                className={cx(
                  'max-w-full truncate px-3 text-[13px] font-semibold',
                  on ? 'text-slate-100' : 'text-slate-250',
                )}
              >
                {p.name}
              </span>
              <span className="max-w-full px-3 font-mono text-[9px] leading-tight text-slate-450">
                {profileSummary(p)}
              </span>
            </button>
          );
        })}

        <div className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border border-white/[0.08] bg-[rgba(8,9,10,0.85)]">
          <span className="font-mono text-[9px] tracking-[0.16em] text-slate-450">PROFILE</span>
          <button onClick={onClose} className="text-[11px] font-medium text-slate-400 hover:text-slate-200">
            cancel
          </button>
        </div>

        {error && (
          <p className="absolute inset-x-0 -bottom-8 text-center text-[12.5px] text-dangerInk">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
