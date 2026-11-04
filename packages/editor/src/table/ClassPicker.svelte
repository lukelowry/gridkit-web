<script lang="ts">
  import { collections } from '@gridkit/library';
  import { collectionLabel, type Entry } from '../domain/entries.js';
  import { classesOf } from './rows.js';
  import Popover from '../ui/Popover.svelte';
  import Icon from '../ui/Icon.svelte';
  import SearchField from '../ui/SearchField.svelte';

  let { entries, value = $bindable(''), label = 'Class', allLabel = 'Class' }: {
    entries: readonly Entry[]; value?: string; label?: string; allLabel?: string;
  } = $props();
  let query = $state('');
  const choices = $derived(classesOf(entries));
  const selected = $derived(choices.find(choice => choice.key === value));
  const shown = $derived(choices.filter(choice => choice.display.toLowerCase().includes(query.trim().toLowerCase())));
</script>

<Popover {label} onopen={() => { query = ''; }}>
  {#snippet trigger(id)}
    <button class="class-trigger" aria-label={label} title={selected?.display ?? 'Filter by class'} popovertarget={id}>
      <span>{selected?.display ?? allLabel}</span><Icon name="chevron" />
    </button>
  {/snippet}
  {#snippet children(close)}
    <div class="class-search"><SearchField label="Find classes" bind:value={query} /></div>
    <div class="class-choices">
      <button class="category-link" aria-label="All classes" aria-pressed={!value} onclick={() => { value = ''; close(); }}>All classes<span class="class-count">{entries.length.toLocaleString()}</span></button>
      {#each collections as collection (collection)}
        {@const items = shown.filter(choice => choice.collection === collection)}
        {#if items.length}
          <div class="class-group" role="group" aria-label={collectionLabel[collection]}>
            <p>{collectionLabel[collection]}</p>
            {#each items as choice (choice.key)}
              <button class="category-link" aria-label={choice.display} aria-pressed={value === choice.key} onclick={() => { value = choice.key; close(); }}>
                <span>{choice.display}</span><span class="class-count">{choice.count.toLocaleString()}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      {#if !shown.length}<p class="property-empty">No matching classes.</p>{/if}
    </div>
  {/snippet}
</Popover>

<style>
  .class-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; max-width: 12rem; min-width: 0; min-height: var(--control-height); padding: 0; border: 0; color: var(--color-text-2); text-align: left; }
  .class-trigger > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .class-trigger :global(svg) { flex: none; width: 12px; height: 12px; }
  .class-search { padding: 8px; border-bottom: 1px solid var(--color-border); }
  .class-choices { padding: 4px; overflow: auto; overscroll-behavior: contain; }
  .category-link { min-height: var(--control-height); }
  .category-link > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .class-count { margin-left: auto; color: var(--color-text-3); font: var(--type-caption); font-variant-numeric: tabular-nums; }
  .class-group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--color-divider); }
  .class-group p { margin: 4px 8px; color: var(--color-text-3); font: var(--type-caption); }
  .property-empty { margin: 12px 8px; }
</style>
