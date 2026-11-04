<script lang="ts" module>
  import type { IconName } from './icons.js';
  /** A command a menu offers; `keys` is the shortcut that runs it too, as shown and as `aria-keyshortcuts` names it. */
  export interface MenuItem {
    readonly label: string; readonly run: () => void; readonly disabled?: boolean;
    readonly icon?: IconName;
    readonly keys?: { readonly shown: string; readonly aria: string } | undefined;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  let { label, at, groups, onclose }: {
    label: string; at: { readonly x: number; readonly y: number }; groups: readonly (readonly MenuItem[])[]; onclose: () => void;
  } = $props();
  const shown = $derived(groups.filter(group => group.length));
  const items = (menu: Element) => [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  let opener: Element | null = null;
  let closed = false;

  // Opens at the point it was asked for, flipped to the other side of it where the viewport ends, and never past an edge.
  function mount(menu: HTMLDivElement) {
    opener = document.activeElement;
    menu.showPopover();
    const { width, height } = menu.getBoundingClientRect();
    const place = (point: number, size: number, room: number) => Math.max(8, Math.min(point + size > room - 8 ? point - size : point, room - size - 8));
    menu.style.left = `${place(at.x, width, innerWidth)}px`;
    menu.style.top = `${place(at.y, height, innerHeight)}px`;
    items(menu)[0]?.focus();
  }
  /** Closes once: Escape and a choice give focus back, a press outside leaves it where the press put it. */
  function close(restore: boolean) {
    if (closed) return;
    closed = true;
    if (restore && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    onclose();
  }
  function keydown(event: KeyboardEvent) {
    const all = items(event.currentTarget as Element), current = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = ({ ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (next !== undefined) { event.preventDefault(); all[(next + all.length) % all.length]?.focus(); }
  }
</script>

<!-- The menu key's own contextmenu event arrives once the menu has focus, and must not open the browser's over it. -->
<div class="menu c-popover" popover="auto" role="menu" tabindex="-1" aria-label={label} {@attach mount} onkeydown={keydown}
  oncontextmenu={event => event.preventDefault()}
  onpointermove={event => { if (event.target instanceof Element) event.target.closest<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }); }}
  ontoggle={event => { if (event.newState === 'closed') close(false); }}>
  {#each shown as group, index (index)}
    {#if index}<div class="rule" role="separator"></div>{/if}
    {#each group as item (item.label)}
      <button class="c-action" type="button" role="menuitem" tabindex="-1" aria-disabled={item.disabled || undefined} aria-keyshortcuts={item.keys?.aria}
        onclick={() => { if (!item.disabled) { close(true); item.run(); } }}>
        {#if item.icon}<Icon name={item.icon} />{/if}<span>{item.label}</span>{#if item.keys}<small aria-hidden="true">{item.keys.shown}</small>{/if}
      </button>
    {/each}
  {/each}
</div>

<style>
  /* Commands take the shared control height and padding, as picker choices do; the focused one carries the hover wash. */
  .menu { position: fixed; inset: auto; margin: 0; min-width: 12rem; max-width: min(20rem, calc(100vw - 16px)); max-height: calc(100dvh - 16px); padding: var(--spacing-xs); overflow: auto; overscroll-behavior: contain; }
  button :global(svg) { width: 14px; height: 14px; }
  button:focus { background: var(--color-row-hover); }
  button[aria-disabled="true"] { opacity: 0.4; cursor: default; }
  span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  small { flex: none; color: var(--color-text-3); font: var(--type-caption); }
  .rule { height: 1px; margin-block: var(--spacing-xs); background: var(--color-divider); }
  @media (forced-colors: active) { button:focus { outline: var(--focus-width) solid Highlight; outline-offset: calc(-1 * var(--focus-width)); } }
</style>
