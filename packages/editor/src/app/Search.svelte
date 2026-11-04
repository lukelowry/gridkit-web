<script lang="ts">
  import { tick } from 'svelte';
  import type { Entry } from '../domain/entries.js';
  import { classKey, columns, tableSource } from '../table/rows.js';
  import ClassPicker from '../table/ClassPicker.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import VirtualTable from '../ui/VirtualTable.svelte';

  let { entries, onselect, query = $bindable(''), inline = false, matchCount = null, onnavigate }: {
    entries: readonly Entry[]; onselect: (entry: Entry) => void; query?: string;
    matchCount?: number | null;
    inline?: boolean; onnavigate?: () => void;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement | undefined;
  let input = $state<HTMLInputElement>();
  let field = $state<SearchField>();
  let selectedClass = $state('');
  let expanded = $state(false);
  const source = $derived(tableSource(entries.filter(entry => !selectedClass || classKey(entry) === selectedClass)));
  const byId = $derived(new Map(entries.map(entry => [entry.id, entry])));

  function outside(event: Event) {
    if (root && event.target instanceof Node && !root.contains(event.target)) expanded = false;
  }
  async function keydown(event: KeyboardEvent) {
    if (!root || event.isComposing) return;
    if (event.key === 'Escape' && root.querySelector(':popover-open')) return;
    if (inline) {
      if (event.target !== input) return;
      if (event.key === 'Escape') { event.preventDefault(); query = ''; }
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); onnavigate?.(); }
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      expanded = false;
      if (document.activeElement !== input) field?.focus();
    } else if (event.key === 'ArrowDown' && event.target === input) {
      event.preventDefault();
      expanded = true;
      await tick();
      root?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    }
  }
  function choose(key: string | null) {
    const entry = key === null ? undefined : byId.get(key);
    if (entry) {
      query = '';
      expanded = false;
      field?.focus();
      onselect(entry);
    }
  }
</script>

<svelte:document onpointerdown={outside} onfocusin={outside} onkeydown={keydown} />
<div class="search" bind:this={root}>
  <SearchField label="Search elements" role={inline ? 'searchbox' : 'combobox'}
    bind:this={field}
    aria-autocomplete={inline ? undefined : 'list'} aria-haspopup={inline ? undefined : 'grid'}
    aria-expanded={inline ? undefined : expanded} aria-controls={inline ? 'case-elements' : expanded ? id : undefined}
    bind:input bind:value={query} onfocus={() => { expanded = !inline; }}
    oninput={() => { expanded = !inline; }} onclick={() => { expanded = !inline; }}>
    {#snippet trailing()}
      {#if inline && query.trim() && matchCount !== null}<output class="match-count">{matchCount.toLocaleString()} {matchCount === 1 ? 'match' : 'matches'}</output>{/if}
    {/snippet}
  </SearchField>
  {#if expanded && !inline}
    <div class="search-results c-popover">
      {#snippet classHeader()}<ClassPicker {entries} bind:value={selectedClass} label="Search class" />{/snippet}
      <VirtualTable {id} {source} {columns} identity={{ label: 'ID', width: 96 }} label="Search results"
        {query} columnHeaders={{ class: classHeader }} bind:selected={() => null, choose} emptyText="No matching elements.">
      </VirtualTable>
    </div>
  {/if}
</div>

<style>
  .match-count { flex: none; color: var(--color-text-3); font: var(--type-caption); white-space: nowrap; }
  .search { position: relative; min-width: 0; width: 100%; }
  .search-results {
    position: absolute; z-index: 5; top: calc(100% + 8px); right: 0;
    display: flex; flex-direction: column; overflow: hidden;
    width: min(560px, calc(100vw - 32px)); height: min(360px, calc(100dvh - 140px));
  }
  @media (max-width: 640px) { .search-results { width: 100%; } }
</style>
