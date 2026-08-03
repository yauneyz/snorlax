import React, { useCallback, useEffect, useState } from 'react';
import type { Drive } from '@talysman/shared';
import { ErrorCode } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx, formatTime } from '../lib/utils.js';
import { Badge, Button, Card, Input, Kicker } from '../components/ui/index.js';

export function Keys() {
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const refresh = useFocusStore((s) => s.refresh);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async (showProgress = true) => {
    if (showProgress) setScanning(true);
    if (showProgress) setError(null);
    try {
      const { drives } = await request('listRemovableDrives', undefined);
      setDrives(drives);
      setSelected((current) =>
        drives.some((drive) => drive.id === current) ? current : (drives[0]?.id ?? ''),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (showProgress) setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
    const timer = window.setInterval(() => void scan(false), 3_000);
    return () => window.clearInterval(timer);
  }, [scan]);

  async function pair() {
    if (!selected) return;
    setError(null);
    try {
      await request('pairKey', { driveId: selected, label: label.trim() });
      setLabel('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unpair(keyId: string) {
    setError(null);
    try {
      await request('unpairKey', { keyId });
      await refresh();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code === ErrorCode.KEY_REQUIRED
          ? 'Removing a key is itself key-gated — insert a paired key first.'
          : code === ErrorCode.LAST_PAIRED_KEY
            ? 'Pair another key before removing your last key.'
          : (e as Error).message,
      );
    }
  }

  const selectedDrive = drives.find((d) => d.id === selected);

  return (
    <div className="flex flex-col gap-3 py-3">
      <div
        className={cx(
          'flex items-center gap-3.5 rounded-xl border px-4 py-3.5',
          keyPresent ? 'border-seal/28 bg-seal/[0.09]' : 'border-danger/30 bg-danger/[0.10]',
        )}
      >
        <span
          className={cx(
            'block h-2.5 w-2.5 animate-pulse rounded-full',
            keyPresent
              ? 'bg-seal shadow-[0_0_10px_2px_rgba(79,214,192,0.6)]'
              : 'bg-danger shadow-[0_0_10px_2px_rgba(255,107,107,0.55)]',
          )}
        />
        <div>
          <div
            className={cx(
              'text-[14px] font-semibold',
              keyPresent ? 'text-sealInk' : 'text-dangerInk',
            )}
          >
            {keyPresent ? 'Key mounted' : 'No key mounted'}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-400">
            {keyPresent
              ? 'Controls are unlocked while a paired drive is connected.'
              : 'Insert a paired drive to turn focus off or loosen a profile.'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="flex flex-col">
          <Kicker>Paired keys · {pairedKeys.length}</Kicker>
          <ul className="mt-3 flex flex-col gap-2">
            {pairedKeys.map((k) => (
              <li
                key={k.id}
                className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="block h-1.5 w-1.5 rounded-full bg-white/25" />
                    <span className="text-[12.5px] font-semibold text-slate-150">{k.label}</span>
                    {k.serialAmbiguous && <Badge tone="neutral">file fallback</Badge>}
                  </span>
                  <button
                    onClick={() => unpair(k.id)}
                    disabled={pairedKeys.length === 1}
                    className="text-[11px] font-medium text-slate-500 transition hover:text-dangerInk disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600"
                  >
                    unpair
                  </button>
                </div>
                <div className="mt-1.5 font-mono text-[10.5px] text-slate-450">
                  paired {formatTime(k.pairedAt)}
                </div>
              </li>
            ))}
            {pairedKeys.length === 0 && (
              <p className="text-[12px] text-slate-500">No keys paired yet.</p>
            )}
          </ul>
          <p className="mt-auto pt-3 text-[11px] leading-relaxed text-slate-450">
            {pairedKeys.length === 1
              ? 'Pair another key before removing your last key.'
              : 'You can’t unpair your last key — pair a spare first and keep it somewhere inconvenient.'}
          </p>
        </Card>

        <Card className="flex flex-col">
          <div className="flex items-baseline justify-between">
            <Kicker>Pair a new key</Kicker>
            <button
              onClick={() => void scan()}
              disabled={scanning}
              className="text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
            >
              {scanning ? 'Scanning…' : 'Rescan'}
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            {drives.map((d) => {
              const on = d.id === selected;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  className={cx(
                    'flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition',
                    on
                      ? 'border-seal/30 bg-seal/[0.09]'
                      : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14]',
                  )}
                >
                  <span
                    className={cx(
                      'block h-2 w-2 shrink-0 rounded-full border',
                      on
                        ? 'border-seal bg-seal shadow-[0_0_7px_1px_rgba(79,214,192,0.6)]'
                        : 'border-white/25 bg-transparent',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-slate-150">
                      {d.label}
                    </span>
                    {d.serialAmbiguous && (
                      <span className="mt-0.5 block font-mono text-[10.5px] text-slate-450">
                        no stable serial · uses a file marker
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {drives.length === 0 && (
              <p className="text-[12px] text-slate-500">No removable drives found.</p>
            )}
          </div>

          {selectedDrive?.serialAmbiguous && (
            <p className="mt-3 text-[11.5px] text-warn">
              This drive has no stable identifier, so Talysman must store a fallback marker on it.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label · e.g. Desk key"
            />
            <Button onClick={pair} disabled={!selected} className="shrink-0 px-5">
              Pair this drive
            </Button>
          </div>
          {error && <p className="mt-3 text-[12.5px] text-dangerInk">{error}</p>}

          <div className="mt-auto flex items-center gap-2 pt-3">
            <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-seal" />
            <span className="text-[11px] text-slate-500">Watching for new drives…</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
