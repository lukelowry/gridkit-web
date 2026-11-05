<script lang="ts">
  import { flushSync, type Snippet } from 'svelte';
  import { trackFloating } from './floating.js';
  let { label, width = 280, align = 'start', trigger, children, onopen, onclose }: {
    label: string; width?: number; align?: 'start' | 'end';
    trigger: Snippet<[string]>; children: Snippet<[() => void]>; onopen?: () => void; onclose?: () => void;
  } = $props();
  const id = $props.id();
  let anchor: HTMLDivElement, popup: HTMLDivElement;
  export function close() {
    popup.hidePopover();
    anchor.querySelector('button')?.focus({ preventScroll: true });
  }
  function mount(node: HTMLDivElement) { return trackFloating(node, () => anchor, { width, align }); }
  function focusContents() {
    const visible = (selector: string) => [...popup.querySelectorAll<HTMLElement>(selector)].find(element => element.checkVisibility());
    const target = visible('button[aria-pressed="true"]:not(:disabled), input[type="radio"]:checked:not(:disabled), [role="grid"]')
      ?? visible('button:not(:disabled), select:not(:disabled), input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled)') ?? popup;
    target.focus({ preventScroll: true });
    if (target !== popup) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
</script>

<div class="popover-anchor" bind:this={anchor}>{@render trigger(id)}</div>
<div {id} popover="auto" role="dialog" tabindex="-1" aria-label={label} class="popover c-popover" bind:this={popup} {@attach mount}
  onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
  onbeforetoggle={event => { if (event.newState === 'open') flushSync(() => onopen?.()); else onclose?.(); }}
  ontoggle={event => {
    if (event.newState === 'open' && popup.matches(':popover-open') && !popup.contains(document.activeElement)) focusContents();
  }}>
  {@render children(close)}
</div>

<style>
  .popover-anchor { display: flex; min-width: 0; }
  .popover { position: fixed; inset: auto; margin: 0; overflow: auto; overscroll-behavior: contain; }
  .popover:popover-open { display: flex; flex-direction: column; }
</style>
