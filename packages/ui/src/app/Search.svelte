<script lang="ts">
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import Icon from '../ui/Icon.svelte';
  import SearchField from '../ui/SearchField.svelte';
  let { query = $bindable(''), matchCount = null, onnavigate }: {
    query?: string; matchCount?: number | null; onnavigate: () => void;
  } = $props();
  const id = $props.id();
  const mobile = new MediaQuery('(max-width: 767px)');
  let mobileOpen = $state(false), trigger: HTMLButtonElement, root: HTMLDivElement;
  let input = $state<HTMLInputElement>();
  async function toggleMobile() { mobileOpen = !mobileOpen; if (mobileOpen) { await tick(); input?.focus(); } }
  function closeMobile() { mobileOpen = false; trigger?.focus({ preventScroll: true }); }
  function outside(event: Event) { if (root && event.target instanceof Node && !root.contains(event.target)) mobileOpen = false; }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || !root?.contains(event.target as Node)) return;
    if (mobile.current && mobileOpen && event.key === 'Escape') { event.preventDefault(); closeMobile(); return; }
    if (event.target !== input) return;
    if (event.key === 'Escape') { event.preventDefault(); query = ''; }
    if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); mobileOpen = false; onnavigate(); }
  }
</script>
<svelte:document onpointerdown={outside} onfocusin={outside} onkeydown={keydown} />
<div class="search" bind:this={root}>
  <button type="button" class={['mobile-search c-icon-btn', { filtered: !!query.trim() }]} aria-label={query.trim() ? 'Search elements (filter active)' : 'Search elements'}
    title="Search elements" aria-expanded={mobileOpen} aria-controls={id + '-panel'} bind:this={trigger} onclick={toggleMobile}><Icon name="search" /></button>
  <div id={id + '-panel'} class={['search-panel', { 'mobile-open': mobileOpen }]}>
    <div class="search-input">
      <SearchField label="Search elements" aria-controls="case-elements" bind:input bind:value={query}>
        {#snippet trailing()}
          {#if query.trim() && matchCount !== null}<output class="match-count">{matchCount.toLocaleString()} {matchCount === 1 ? 'match' : 'matches'}</output>{/if}
        {/snippet}
      </SearchField>
      <button type="button" class="mobile-search c-icon-btn" aria-label="Close search" title="Close search" onclick={closeMobile}><Icon name="close" /></button>
    </div>
  </div>
</div>

<style>
  .mobile-search { display: none; }
  .search-input { display: flex; align-items: center; gap: var(--spacing-xs); min-width: 0; }
  .search-input :global(.search-field) { flex: 1; }
  .filtered { color: var(--color-primary-text); background: var(--color-selected); border-color: var(--color-selection-border); }
  .match-count { flex: none; color: var(--color-text-3); font: var(--type-caption); white-space: nowrap; }
  .search { position: relative; min-width: 0; width: 100%; }
  @media (max-width: 767px) {
    .search { position: static; }
    .mobile-search { display: inline-grid; }
    .search-panel { display: none; position: absolute; inset: 100% 0 auto; padding: var(--spacing-sm) calc(var(--spacing-sm) + var(--safe-right)) var(--spacing-sm) calc(var(--spacing-sm) + var(--safe-left)); background: var(--color-surface-1); border-bottom: 1px solid var(--color-border); }
    .search-panel.mobile-open { display: block; }
    .match-count { max-width: 7ch; white-space: normal; text-align: right; }
  }
</style>
