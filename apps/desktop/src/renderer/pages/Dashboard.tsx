import React from 'react';
import { resolveActiveProfile } from '@talysman/shared';
import { productFeaturesForEnvironment } from '@talysman/product';
import { useFocusStore } from '../store/useFocusStore.js';
import { FocusToggle } from '../components/FocusToggle.js';
import { Kicker } from '../components/ui/index.js';

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** One compact instrument reading — kicker on top, value below. */
function Readout({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  const color =
    tone === 'ok' ? 'text-okInk' : tone === 'danger' ? 'text-dangerInk' : 'text-slate-200';
  return (
    <div className="instrument-card rounded-[14px] border border-white/[0.08] px-4 py-3.5">
      <Kicker className="text-[9.5px] tracking-[0.18em]">{label}</Kicker>
      <div className={`mt-1.5 font-mono text-[15px] font-medium ${color}`}>{value}</div>
    </div>
  );
}

export function Dashboard() {
  const policy = useFocusStore((s) => s.policy);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const schedule = useFocusStore((s) => s.schedule);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  // "block-all"-equivalent: block by default, nothing carved out.
  const isBlockAll =
    policy.defaultAction === 'block' &&
    policy.blockedDomains.length === 0 &&
    policy.allowedDomains.length === 0 &&
    !(SMART_FILTERING_ENABLED && policy.intent);
  const listLabel = policy.defaultAction === 'block' ? 'sites allowed' : 'sites blocked';
  const listCount =
    policy.defaultAction === 'block' ? policy.allowedDomains.length : policy.blockedDomains.length;

  return (
    <div className="dashboard-stage flex min-h-full flex-col items-center justify-center gap-8 py-6">
      <FocusToggle />

      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        <Readout
          label="Key"
          value={keyPresent ? 'present' : pairedKeys.length === 0 ? 'none paired' : 'away'}
          tone={keyPresent ? 'ok' : pairedKeys.length === 0 ? 'danger' : undefined}
        />
        <Readout label="Profiles" value={String(profiles.length)} />
        <Readout
          label={isBlockAll ? 'Everything' : listLabel}
          value={isBlockAll ? 'blocked' : String(listCount)}
        />
        <Readout label="Schedule windows" value={String(schedule.windows.length)} />
      </div>

      {activeProfile && (
        <p className="text-[12px] text-slate-450">
          Focus holds this profile until you or the schedule switch it.
        </p>
      )}
    </div>
  );
}
