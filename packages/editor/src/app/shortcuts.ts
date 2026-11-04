type ShortcutDefinition = { key: string; mod?: boolean; shift?: boolean };

// One definition drives key matching, visible hints, and accessibility metadata.
const shortcuts = {
  undo: { key: 'z', mod: true }, redo: { key: 'z', mod: true, shift: true },
  cancel: { key: 'Escape' }, open: { key: 'Enter' }, delete: { key: 'Delete' },
} as const satisfies Record<string, ShortcutDefinition>;
export type ShortcutId = keyof typeof shortcuts;
export const appleKeyboard = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function alternatives(id: ShortcutId): readonly ShortcutDefinition[] {
  if (id === 'delete') return [shortcuts.delete, { key: 'Backspace' }];
  return id === 'redo' && !appleKeyboard ? [shortcuts.redo, { key: 'y', mod: true }] : [shortcuts[id]];
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  if (event.isComposing || event.altKey || event.getModifierState('AltGraph')) return false;
  return alternatives(id).some(shortcut =>
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.shiftKey === !!shortcut.shift &&
    event.metaKey === (appleKeyboard && !!shortcut.mod) &&
    event.ctrlKey === (!appleKeyboard && !!shortcut.mod));
}

export function shortcutKeys(id: ShortcutId): readonly string[] {
  const shortcut: ShortcutDefinition = shortcuts[id];
  return [
    ...(appleKeyboard && shortcut.shift ? ['⇧'] : []),
    ...(shortcut.mod ? [appleKeyboard ? '⌘' : 'Ctrl'] : []),
    ...(!appleKeyboard && shortcut.shift ? ['Shift'] : []),
    shortcut.key === 'Escape' ? 'Esc' : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ];
}

export function ariaShortcut(id: ShortcutId): string {
  return alternatives(id).map(shortcut => [
    ...(shortcut.mod ? [appleKeyboard ? 'Meta' : 'Control'] : []),
    ...(shortcut.shift ? ['Shift'] : []),
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].join('+')).join(' ');
}

/** A shortcut as a menu shows it, and as `aria-keyshortcuts` names it. */
export function shortcutHint(id: ShortcutId): { shown: string; aria: string } {
  return { shown: shortcutKeys(id).join(appleKeyboard ? '' : '+'), aria: ariaShortcut(id) };
}

export function shortcutTitle(label: string, id: ShortcutId): string {
  return `${label} (${shortcutHint(id).shown})`;
}
