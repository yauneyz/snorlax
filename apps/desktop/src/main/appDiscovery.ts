import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { promisify } from 'node:util';
import type { AppRef } from '@talysman/shared';
import type { AppPickerItem } from '../shared/appPicker.js';

interface DesktopEntry {
  name?: string;
  exec?: string;
  type?: string;
  hidden?: string;
  noDisplay?: string;
}

const execFileAsync = promisify(execFile);

export function parseDesktopEntry(content: string): DesktopEntry {
  const entry: DesktopEntry = {};
  let inDesktopEntry = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const section = /^\[(.+)]$/.exec(line);
    if (section) {
      inDesktopEntry = section[1] === 'Desktop Entry';
      continue;
    }
    if (!inDesktopEntry) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq);
    const value = line.slice(eq + 1).trim();
    if (key === 'Name') entry.name = value;
    if (key === 'Exec') entry.exec = value;
    if (key === 'Type') entry.type = value;
    if (key === 'Hidden') entry.hidden = value;
    if (key === 'NoDisplay') entry.noDisplay = value;
  }

  return entry;
}

function shellWords(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current) words.push(current);
  return words;
}

export function linuxProcessNameFromExec(exec: string): string | null {
  const cleaned = exec.replace(/%[a-zA-Z]/g, '').trim();
  const command = shellWords(cleaned)[0];
  if (!command) return null;

  const name = basename(command);
  return name || null;
}

export function linuxPickerItemFromDesktopFile(
  content: string,
  _filePath: string,
): AppPickerItem | null {
  const entry = parseDesktopEntry(content);
  if (entry.type && entry.type !== 'Application') return null;
  if (entry.hidden === 'true' || entry.noDisplay === 'true') return null;
  if (!entry.name || !entry.exec) return null;

  const linuxProcessName = linuxProcessNameFromExec(entry.exec);
  if (!linuxProcessName) return null;

  const app: AppRef = {
    label: entry.name,
    linuxProcessName,
  };
  return {
    id: `linux:${linuxProcessName}`,
    label: entry.name,
    source: 'linux-desktop-entry',
    app,
  };
}

function appIdentityKey(app: AppRef): string {
  return [
    app.windowsImageName?.toLowerCase() ?? '',
    app.linuxProcessName?.toLowerCase() ?? '',
    app.macBundleId ?? '',
  ].join('|');
}

function sortAndDedupe(items: AppPickerItem[]): AppPickerItem[] {
  const seen = new Set<string>();
  const deduped: AppPickerItem[] = [];
  for (const item of items) {
    const key = appIdentityKey(item.app);
    if (!key.replaceAll('|', '') || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

async function collectFiles(root: string, extension: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(path, extension)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === extension) {
      out.push(path);
    }
  }
  return out;
}

export function linuxApplicationRoots(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const xdgDataHome = env.XDG_DATA_HOME || join(home, '.local/share');
  const xdgDataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean);

  return [
    ...new Set([
      join(xdgDataHome, 'applications'),
      ...xdgDataDirs.map((root) => join(root, 'applications')),
      // Snap does not always add its desktop-entry directory to XDG_DATA_DIRS.
      '/var/lib/snapd/desktop/applications',
      // NixOS applications may come from the active system, user, or default Nix profile.
      // Desktop sessions usually expose these via XDG_DATA_DIRS, but apps launched outside
      // that session (including Electron development builds) do not necessarily inherit it.
      '/run/current-system/sw/share/applications',
      join(home, '.nix-profile/share/applications'),
      env.USER ? join('/etc/profiles/per-user', env.USER, 'share/applications') : '',
      '/nix/var/nix/profiles/default/share/applications',
    ].filter(Boolean)),
  ];
}

async function listLinuxInstalledApps(): Promise<AppPickerItem[]> {
  const roots = linuxApplicationRoots();
  const files = (await Promise.all(roots.map((root) => collectFiles(root, '.desktop')))).flat();
  const items: AppPickerItem[] = [];

  for (const file of files) {
    try {
      const item = linuxPickerItemFromDesktopFile(await readFile(file, 'utf8'), file);
      if (item) items.push(item);
    } catch {
      // Ignore unreadable or malformed desktop entries.
    }
  }

  return sortAndDedupe(items);
}

function plistString(content: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `<key>\\s*${escapedKey}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`,
  ).exec(content);
  if (!match?.[1]) return null;
  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .trim() || null;
}

export function macPickerItemFromInfoPlist(
  content: string,
  appPath: string,
): AppPickerItem | null {
  const macBundleId = plistString(content, 'CFBundleIdentifier');
  if (!macBundleId) return null;
  const label =
    plistString(content, 'CFBundleDisplayName') ||
    plistString(content, 'CFBundleName') ||
    basename(appPath, '.app');

  return {
    id: `mac:${macBundleId}`,
    label,
    source: 'macos-application-bundle',
    app: { label, macBundleId },
  };
}

async function collectMacAppBundles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const bundles: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name.toLowerCase().endsWith('.app')) {
      bundles.push(path);
    } else {
      bundles.push(...(await collectMacAppBundles(path)));
    }
  }
  return bundles;
}

async function listMacInstalledApps(): Promise<AppPickerItem[]> {
  const roots = [
    '/Applications',
    '/System/Applications',
    join(homedir(), 'Applications'),
  ];
  const bundles = (await Promise.all(roots.map(collectMacAppBundles))).flat();
  const items: AppPickerItem[] = [];

  for (const bundle of bundles) {
    const infoPlist = join(bundle, 'Contents/Info.plist');
    try {
      // Info.plist is commonly a binary plist. plutil is part of macOS and gives us
      // one consistent XML representation without adding a main-process dependency.
      const { stdout } = await execFileAsync(
        '/usr/bin/plutil',
        ['-convert', 'xml1', '-o', '-', infoPlist],
        { maxBuffer: 1024 * 1024 },
      );
      const item = macPickerItemFromInfoPlist(stdout, bundle);
      if (item) items.push(item);
    } catch {
      // Skip damaged, inaccessible, or non-standard bundles.
    }
  }

  return sortAndDedupe(items);
}

async function listWindowsInstalledApps(): Promise<AppPickerItem[]> {
  const { shell } = await import('electron');
  const roots = [
    process.env.ProgramData
      ? join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs')
      : undefined,
    process.env.APPDATA
      ? join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs')
      : undefined,
  ].filter(Boolean) as string[];

  const files = (await Promise.all(roots.map((root) => collectFiles(root, '.lnk')))).flat();
  const items: AppPickerItem[] = [];

  for (const file of files) {
    try {
      const shortcut = shell.readShortcutLink(file);
      const windowsImageName = basename(shortcut.target).toLowerCase();
      if (!windowsImageName || extname(windowsImageName).toLowerCase() !== '.exe') continue;
      const label = basename(file, extname(file));
      items.push({
        id: `win:${windowsImageName}`,
        label,
        source: 'windows-start-menu',
        app: { label, windowsImageName },
      });
    } catch {
      // Broken shortcuts are common enough in Start Menu folders; skip them.
    }
  }

  return sortAndDedupe(items);
}

export async function listInstalledApps(): Promise<AppPickerItem[]> {
  switch (platform()) {
    case 'win32':
      return listWindowsInstalledApps();
    case 'linux':
      return listLinuxInstalledApps();
    case 'darwin':
      return listMacInstalledApps();
    default:
      return [];
  }
}
