/**
 * Removable drives the user has hidden from the "pair a key" pickers — e.g. an external disk that's
 * always plugged in and will never be a key. Purely a renderer convenience, so it lives in
 * localStorage; losing it just means the drive shows up again.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Drive } from '@talysman/shared';

const STORAGE_KEY = 'talysman.ignoredDrives';

export interface IgnoredDrive {
  id: string;
  label: string;
}

const listeners = new Set<() => void>();
let cache: IgnoredDrive[] | null = null;

function read(): IgnoredDrive[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    cache = Array.isArray(parsed)
      ? parsed.filter(
          (d): d is IgnoredDrive => typeof d?.id === 'string' && typeof d?.label === 'string',
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: IgnoredDrive[]) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Remembering the choice is a convenience; nothing breaks without it.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIgnoredDrives() {
  const ignored = useSyncExternalStore(subscribe, read);

  const ignore = useCallback((drive: Drive) => {
    const current = read();
    if (current.some((d) => d.id === drive.id)) return;
    write([...current, { id: drive.id, label: drive.label }]);
  }, []);

  const unignore = useCallback((id: string) => {
    write(read().filter((d) => d.id !== id));
  }, []);

  const isIgnored = useCallback((id: string) => ignored.some((d) => d.id === id), [ignored]);

  return { ignored, ignore, unignore, isIgnored };
}
