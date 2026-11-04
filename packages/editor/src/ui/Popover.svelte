<script lang="ts">
  import { flushSync, onMount, type Snippet } from 'svelte';

  let { label, width = 280, align = 'start', trigger, children, onopen, onclose }: {
    label: string; width?: number; align?: 'start' | 'end';
    trigger: Snippet<[string]>; children: Snippet<[() => void]>; onopen?: () => void; onclose?: () => void;
  } = $props();
  const id = $props.id();
  let anchor: HTMLDivElement;
  let popup: HTMLDivElement;

  export function close() {
    popup.hidePopover();
    anchor.querySelector('button')?.focus({ preventScroll: true });
  }

  function focusContents() {
    // Browsing starts at the current choice or list, never in a typing field.
    const visible = (selector: string) => [...popup.querySelectorAll<HTMLElement>(selector)]
      .find(element => element.checkVisibility());
    const target = visible('button[aria-pressed="true"]:not(:disabled), input[type="radio"]:checked:not(:disabled), [role="grid"]')
      ?? visible('button:not(:disabled), select, input[type="checkbox"], input[type="radio"]') ?? popup;
    target.focus({ preventScroll: true });
    if (target !== popup) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function position() {
    const bounds = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
    const right = x + (viewport?.width ?? window.innerWidth) - 8;
    const bottom = y + (viewport?.height ?? window.innerHeight) - 8;
    const size = Math.max(0, Math.min(width, right - x - 8));
    const left = align === 'end' ? bounds.right - size : bounds.left;
    popup.style.width = `${size}px`;
    popup.style.maxHeight = 'none';
    const desired = popup.getBoundingClientRect().height || Infinity;
    const below = Math.max(0, bottom - bounds.bottom - 6);
    const above = Math.max(0, bounds.top - 6 - y - 8);
    const down = below >= desired || below >= above;
    const height = Math.max(0, Math.min(desired, down ? below : above, bottom - y - 8));
    const top = down ? bounds.bottom + 6 : bounds.top - 6 - height;
    popup.style.left = `${Math.max(x + 8, Math.min(left, right - size))}px`;
    popup.style.top = `${Math.max(y + 8, Math.min(top, bottom - height))}px`;
    popup.style.maxHeight = `${height}px`;
  }
  /** Takes its place again, as when what it shows changes size. */
  export function reposition() { if (popup.matches(':popover-open')) position(); }
  onMount(() => {
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', reposition);
    viewport?.addEventListener('scroll', reposition);
    return () => {
      viewport?.removeEventListener('resize', reposition);
      viewport?.removeEventListener('scroll', reposition);
    };
  });
</script>

<svelte:window onresize={reposition} />
<svelte:document onscrollcapture={event => {
  if (popup.matches(':popover-open') && event.target instanceof Element && event.target.contains(anchor)) position();
}} />
<div class="popover-anchor" bind:this={anchor}>{@render trigger(id)}</div>
<div {id} popover="auto" role="dialog" tabindex="-1" aria-label={label} class="popover c-popover" bind:this={popup}
  onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
  onbeforetoggle={event => { if (event.newState === 'open') { flushSync(() => onopen?.()); position(); } else onclose?.(); }}
  ontoggle={event => {
    if (event.newState !== 'open' || !popup.matches(':popover-open')) return;
    position();
    // A delayed toggle must not interrupt someone who has already entered a field.
    if (!popup.contains(document.activeElement)) focusContents();
  }}>
  {@render children(close)}
</div>

<style>
  .popover-anchor { display: flex; min-width: 0; }
  .popover { position: fixed; inset: auto; margin: 0; overflow: auto; }
  .popover:popover-open { display: flex; flex-direction: column; }
</style>
