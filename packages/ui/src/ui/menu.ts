import type { IconName } from './icons.js';

/** Commands are shared by context menus and header menus; presentation owns focus and dismissal. */
export interface MenuItem {
  readonly label: string;
  readonly run: () => void;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly keys?: { readonly shown: string; readonly aria: string } | undefined;
}
