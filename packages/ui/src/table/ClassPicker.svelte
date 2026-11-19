<script lang="ts">
  import { collections } from '@gridkit/library';
  import { collectionLabel, type Entry } from '../domain/entries.js';
  import { classesOf } from './rows.js';
  import Popover from '../ui/Popover.svelte';
  import PickerPanel from '../ui/PickerPanel.svelte';
  import ChoiceRow from '../ui/ChoiceRow.svelte';

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
    <button class="c-select class-trigger" aria-label={label} title={selected?.display ?? 'Filter by class'} popovertarget={id}>
      <span>{selected?.display ?? allLabel}</span>
    </button>
  {/snippet}
  {#snippet children(close)}
    <PickerPanel label="Find classes" bind:query empty={!shown.length && !!query.trim()} emptyText="No matching classes.">
      {#if !query.trim()}<ChoiceRow label="All classes" ariaLabel="All classes" detail={entries.length.toLocaleString()} selected={!value} onselect={() => { value = ''; close(); }} />{/if}
      {#each collections as collection (collection)}
        {@const items = shown.filter(choice => choice.collection === collection)}
        {#if items.length}
          <div class="c-choice-group" role="group" aria-label={collectionLabel[collection]}>
            <p class="c-choice-label">{collectionLabel[collection]}</p>
            {#each items as choice (choice.key)}
              <ChoiceRow label={choice.display} ariaLabel={choice.display} detail={choice.count.toLocaleString()} selected={value === choice.key} onselect={() => { value = choice.key; close(); }} />
            {/each}
          </div>
        {/if}
      {/each}
    </PickerPanel>
  {/snippet}
</Popover>

<style>
  /* In the header it reads as a select without a frame, as the results' quantity does. */
  .class-trigger { max-width: 12rem; border-color: transparent; background-color: transparent; color: var(--color-text-2); font: var(--type-label); }
</style>
