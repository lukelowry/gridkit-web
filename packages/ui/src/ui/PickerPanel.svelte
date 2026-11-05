<script lang="ts">
  import type { Snippet } from 'svelte';
  import SearchField from './SearchField.svelte';
  let { label, query = $bindable(''), search = true, header, footer, leading, children, empty = false, emptyText = 'No matches.', height, maxHeight = 320, virtual = false, onfocusresults }: {
    label: string; query?: string; search?: boolean; header?: Snippet; footer?: Snippet; leading?: Snippet; children: Snippet;
    empty?: boolean; emptyText?: string; height?: number; maxHeight?: number; virtual?: boolean; onfocusresults?: () => void;
  } = $props();
  let results: HTMLDivElement;
  function focusResults() {
    if (onfocusresults) { onfocusresults(); return; }
    const target = [...results.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [role="grid"]')].find(node => node.checkVisibility());
    (target ?? results).focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }
  function navigate(event: KeyboardEvent) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-picker-choice]')) return;
    const choices = [...results.querySelectorAll<HTMLButtonElement>('[data-picker-choice]:not(:disabled)')].filter(node => node.checkVisibility());
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: choices.length - 1 } as Record<string, number>)[event.key];
    if (next !== undefined && choices.length) { event.preventDefault(); choices[(next + choices.length) % choices.length]?.focus(); }
  }
</script>
<div class="picker-panel">
  {#if header}<header>{@render header()}</header>{/if}
  {#if search}<div class="picker-search"><SearchField {label} bind:value={query} onkeydown={event => {
    if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); focusResults(); }
  }} /></div>{/if}
  {@render leading?.()}
  <!-- Only choice-row navigation is intercepted; grids and native inputs retain their own keys. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="picker-results" class:virtual tabindex="-1" bind:this={results} onkeydown={navigate} style:max-height={maxHeight + 'px'} style:height={height === undefined ? undefined : height + 'px'}>
    {#if empty}<p class="picker-empty">{emptyText}</p>{:else}{@render children()}{/if}
  </div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</div>
<style>
  .picker-panel { display: flex; flex-direction: column; flex: 0 1 auto; min-height: 0; min-width: 0; }
  .picker-search { flex: none; padding: var(--spacing-sm); border-bottom: 1px solid var(--color-border); }
  .picker-results { position: relative; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: var(--spacing-xs); }
  .picker-results.virtual { padding: 0; overflow: hidden; flex: 0 1 auto; }
  .picker-empty { margin: 0; padding: var(--spacing-sm); font: var(--type-compact); color: var(--color-text-2); }
  header, footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); }
  header { border-bottom: 1px solid var(--color-border); }
  footer { flex-wrap: wrap; border-top: 1px solid var(--color-border); background: var(--color-surface-2); font: var(--type-caption); color: var(--color-text-2); }
</style>
