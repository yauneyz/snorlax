import type { AppRef } from '@talysman/shared';

export interface AppPickerItem {
  id: string;
  label: string;
  source: 'windows-start-menu' | 'linux-desktop-entry' | 'macos-application-bundle';
  app: AppRef;
}
