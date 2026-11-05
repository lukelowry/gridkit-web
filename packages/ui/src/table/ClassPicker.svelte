<script lang="ts">
  import { collections } from '@gridkit/library';
  import { collectionLabel, type Entry } from '../domain/entries.js';
  import { classesOf } from './rows.js';
  import Popover from '../ui/Popover.svelte';
  import Icon from '../ui/Icon.svelte';
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
    <button class="class-trigger" aria-label={label} title={selected?.display ?? 'Filter by class'} popovertarget={id}>
      <span>{selected?.display ?? allLabel}</span><Icon name="chevron" />
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
  .class-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; max-width: 12rem; min-width: 0; min-height: var(--control-height); padding: 0; border: 0; color: var(--color-text-2); text-align: left; }
  .class-trigger > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .class-trigger :global(svg) { flex: none; width: 12px; height: 12px; }
</style>
