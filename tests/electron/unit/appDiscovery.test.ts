import { describe, expect, it } from 'vitest';
import {
  linuxPickerItemFromDesktopFile,
  linuxProcessNameFromExec,
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
});
