import React from 'react';
import { resolveActiveProfile } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { FocusToggle } from '../components/FocusToggle.js';
import { UsbIndicator } from '../components/UsbIndicator.js';
import { Badge, Card, CardTitle, ProfileDot } from '../components/ui/index.js';

export function Dashboard() {
  const policy = useFocusStore((s) => s.policy);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const schedule = useFocusStore((s) => s.schedule);
  const focusActive = useFocusStore((s) => s.focusActive);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2 flex flex-col items-center justify-center py-12">
        <FocusToggle />
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardTitle hint="The service updates this from the physical USB check.">Key status</CardTitle>
          <UsbIndicator />
        </Card>

        <Card>
          <CardTitle hint="Focus enforces this profile until you or the schedule switch it.">
            Active profile
          </CardTitle>
          <div className="flex items-center gap-2">
            {activeProfile && <ProfileDot color={activeProfile.color} />}
            <span className="text-sm font-medium text-slate-100">
              {activeProfile?.name ?? 'None'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone="neutral">{policy.mode}</Badge>
            <span className="text-sm text-slate-400">
              {policy.domains.length} domains · {policy.apps.length} apps
            </span>
          </div>
        </Card>

        <Card>
          <CardTitle>Status</CardTitle>
          <div className="flex flex-col gap-2 text-sm text-slate-300">
            <div>
              Focus: <Badge tone={focusActive ? 'ok' : 'neutral'}>{focusActive ? 'active' : 'off'}</Badge>
            </div>
            <div>Schedule windows: {schedule.windows.length}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
