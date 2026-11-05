<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MenuItem } from './menu.js';
  import { trackFloating } from './floating.js';
  import Icon from './Icon.svelte';
  let { label, at, groups, onclose, trigger, width = 240, align = 'start' }: {
    label: string; at?: { readonly x: number; readonly y: number };
    groups: readonly (readonly MenuItem[])[]; onclose?: () => void;
    trigger?: Snippet<[string, boolean]>; width?: number; align?: 'start' | 'end';
  } = $props();
  const id = $props.id();
  const shown = $derived(groups.filter(group => group.length));
  const items = () => [...popup.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  let anchor = $state<HTMLDivElement>();
  let popup: HTMLDivElement;
  let expanded = $state(false), opener: Element | null = null, closed = false;
  let initial: 'first' | 'last' = 'first', typed = '', typedAt = 0;
  function mount(menu: HTMLDivElement) {
    const cleanup = trackFloating(menu, () => at ?? anchor!, { width, align });
    if (at) menu.showPopover();
    return cleanup;
  }
  function focusItem(last = false) { const all = items(); (last ? all.at(-1) : all[0])?.focus({ preventScroll: true }); }
  function close(restore: boolean) {
    if (closed) return;
    closed = true; expanded = false;
    popup.hidePopover();
    if (restore && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    onclose?.();
  }
  function openFromKey(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target instanceof HTMLButtonElement && event.target.disabled) return;
    event.preventDefault();
    initial = event.key === 'ArrowUp' ? 'last' : 'first';
    popup.showPopover();
    focusItem(initial === 'last');
  }
  function keydown(event: KeyboardEvent) {
    const all = items(), current = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = ({ ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { event.stopPropagation(); close(true); }
    else if (next !== undefined) { event.preventDefault(); all[(next + all.length) % all.length]?.focus(); }
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed = (now - typedAt < 700 ? typed : '') + event.key.toLocaleLowerCase(); typedAt = now;
      const matches = (prefix: string) => [...all.slice(current + 1), ...all.slice(0, current + 1)].find(item => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix));
      const target = matches(typed) ?? matches(event.key.toLocaleLowerCase());
      if (target) { event.preventDefault(); target.focus(); }
    }
  }
</script>

{#if trigger}
  <!-- The wrapper forwards menu-opening keys from its native button. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="popover-anchor" bind:this={anchor} onkeydown={openFromKey}>{@render trigger(id, expanded)}</div>
{/if}
<div {id} class="menu c-popover" popover="auto" role="menu" tabindex="-1" aria-label={label}
  bind:this={popup} {@attach mount} onkeydown={keydown}
  oncontextmenu={event => event.preventDefault()}
  onpointermove={event => { if ((event.movementX || event.movementY) && event.target instanceof Element) event.target.closest<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }); }}
  onbeforetoggle={event => { if (event.newState === 'open') { opener = anchor?.querySelector('button') ?? document.activeElement; closed = false; expanded = true; typed = ''; } }}
  ontoggle={event => {
    if (event.newState === 'closed') close(false);
    else {
      if (popup.matches(':popover-open') && !popup.contains(document.activeElement)) focusItem(initial === 'last');
      initial = 'first';
    }
  }}>
  {#each shown as group, index (index)}
    <div class="c-options" role="group">
      {#each group as item (item.label)}
        <button class="c-action" type="button" role="menuitem" tabindex="-1" aria-disabled={item.disabled || undefined} aria-keyshortcuts={item.keys?.aria}
          onclick={() => { if (!item.disabled) { close(true); item.run(); } }}>
          {#if item.icon}<Icon name={item.icon} />{/if}<span>{item.label}</span>{#if item.keys}<small aria-hidden="true">{item.keys.shown}</small>{/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .popover-anchor { display: flex; min-width: 0; }
  .menu { position: fixed; inset: auto; margin: 0; overflow: auto; overscroll-behavior: contain; }
  button:focus { background: var(--color-row-hover); }
  span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  small { flex: none; color: var(--color-text-3); font: var(--type-caption); }
  @media (forced-colors: active) { button:focus { outline: var(--focus-width) solid Highlight; outline-offset: calc(-1 * var(--focus-width)); } }
</style>
