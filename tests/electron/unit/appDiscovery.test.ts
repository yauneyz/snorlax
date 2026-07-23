import { describe, expect, it } from 'vitest';
import {
  linuxPickerItemFromDesktopFile,
  linuxApplicationRoots,
  linuxProcessNameFromExec,
  macPickerItemFromInfoPlist,
  parseDesktopEntry,
} from '../../../apps/desktop/src/main/appDiscovery.js';

describe('app discovery helpers', () => {
  it('parses the Desktop Entry section only', () => {
    expect(parseDesktopEntry(`
[Other]
Name=Wrong

[Desktop Entry]
Type=Application
Name=Firefox
Exec=firefox %u
NoDisplay=false
`)).toEqual({
      type: 'Application',
      name: 'Firefox',
      exec: 'firefox %u',
      noDisplay: 'false',
    });
  });

  it('derives process names from desktop Exec values', () => {
    expect(linuxProcessNameFromExec('firefox %u')).toBe('firefox');
    expect(linuxProcessNameFromExec('"/opt/Google Chrome/chrome" --profile-directory=Default %U')).toBe('chrome');
    expect(linuxProcessNameFromExec('/usr/bin/spotify --uri=%u')).toBe('spotify');
  });

  it('discovers XDG, conventional, and NixOS application directories', () => {
    expect(linuxApplicationRoots('/home/alice', {
      USER: 'alice',
      XDG_DATA_HOME: '/home/alice/custom-share',
      XDG_DATA_DIRS: '/opt/share:/run/current-system/sw/share',
    })).toEqual([
      '/home/alice/custom-share/applications',
      '/opt/share/applications',
      '/run/current-system/sw/share/applications',
      '/var/lib/snapd/desktop/applications',
      '/home/alice/.nix-profile/share/applications',
      '/etc/profiles/per-user/alice/share/applications',
      '/nix/var/nix/profiles/default/share/applications',
    ]);
  });

  it('creates picker items from visible application desktop files', () => {
    expect(linuxPickerItemFromDesktopFile(`
[Desktop Entry]
Type=Application
Name=Spotify
Exec=/usr/bin/spotify --uri=%u
`, '/usr/share/applications/spotify.desktop')).toEqual({
      id: 'linux:spotify',
      label: 'Spotify',
      source: 'linux-desktop-entry',
      app: {
        label: 'Spotify',
        linuxProcessName: 'spotify',
      },
    });
  });

  it('skips hidden and non-application desktop files', () => {
    expect(linuxPickerItemFromDesktopFile(`
[Desktop Entry]
Type=Link
Name=Docs
Exec=xdg-open https://example.com
`, 'docs.desktop')).toBeNull();

    expect(linuxPickerItemFromDesktopFile(`
[Desktop Entry]
Type=Application
Name=Hidden
Exec=hidden
NoDisplay=true
`, 'hidden.desktop')).toBeNull();
  });

  it('creates picker items from macOS application bundle metadata', () => {
    expect(macPickerItemFromInfoPlist(`
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.Focus</string>
  <key>CFBundleDisplayName</key>
  <string>Focus &amp; Flow</string>
</dict>
</plist>
`, '/Applications/Focus.app')).toEqual({
      id: 'mac:com.example.Focus',
      label: 'Focus & Flow',
      source: 'macos-application-bundle',
      app: {
        label: 'Focus & Flow',
        macBundleId: 'com.example.Focus',
      },
    });
  });
});
