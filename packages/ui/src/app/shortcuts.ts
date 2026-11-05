const shortcuts = { cancel: 'Escape', open: 'Enter' } as const;
type ShortcutId = keyof typeof shortcuts;

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  return !event.isComposing && !event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey &&
    !event.getModifierState('AltGraph') && event.key === shortcuts[id];
}
export function shortcutHint(id: ShortcutId): { shown: string; aria: string } {
  const key = shortcuts[id];
  return { shown: key === 'Escape' ? 'Esc' : key, aria: key };
}
