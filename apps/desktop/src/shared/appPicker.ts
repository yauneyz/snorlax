import type { AppRef } from '@focuslock/shared';

export interface AppPickerItem {
  id: string;
  label: string;
  source: 'windows-start-menu' | 'linux-desktop-entry';
  app: AppRef;
}
