import React, { useEffect, useState } from 'react';
import type { Drive } from '@talysman/shared';
import { ErrorCode } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { formatTime } from '../lib/utils.js';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';

export function Keys() {
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const refresh = useFocusStore((s) => s.refresh);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const { drives } = await request('listRemovableDrives', undefined);
      setDrives(drives);
      if (drives[0]) setSelected(drives[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    void scan();
  }, []);

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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle hint="Insert a USB drive, pick it, and pair. Any paired key can unlock focus.">
            Pair a new key
          </CardTitle>
          <Button variant="ghost" onClick={scan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>

        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mb-3 w-full rounded-lg border border-border bg-panel2 px-3 py-2 text-sm text-white"
        >
          {drives.length === 0 && <option value="">No removable drives found</option>}
          {drives.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>

        {selectedDrive?.serialAmbiguous && (
          <p className="mb-3 text-xs text-amber-400">
            ⚠ This drive can't be uniquely identified by serial; presence will rely on the key file.
          </p>
        )}

        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Desk key)"
          className="mb-3"
        />
        <Button onClick={pair} disabled={!selected}>
          Pair this drive
        </Button>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </Card>

      <Card>
        <CardTitle>Paired keys</CardTitle>
        <ul className="flex flex-col gap-2">
          {pairedKeys.map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
              <span className="text-sm text-slate-200">
                {k.label} {k.serialAmbiguous && <Badge tone="neutral">file-only</Badge>}
                <span className="ml-2 text-xs text-slate-500">paired {formatTime(k.pairedAt)}</span>
              </span>
              <button
                onClick={() => unpair(k.id)}
                disabled={pairedKeys.length === 1}
                className="text-xs text-red-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
              >
                unpair
              </button>
            </li>
          ))}
          {pairedKeys.length === 0 && <p className="text-sm text-slate-500">No keys paired yet.</p>}
          {pairedKeys.length === 1 && (
            <p className="text-sm text-slate-500">Pair another key before removing your last key.</p>
          )}
        </ul>
      </Card>
    </div>
  );
}
