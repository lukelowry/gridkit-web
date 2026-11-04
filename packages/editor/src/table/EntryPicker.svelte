<script lang="ts">
  import { entryColumns, type EntryChoices } from './rows.js';
  import Popover from '../ui/Popover.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import VirtualTable from '../ui/VirtualTable.svelte';
  import Icon from '../ui/Icon.svelte';

  let { choices, value = $bindable(''), id, label, collectionLabel, clearLabel, unresolved,
    invalid = false, describedby, onchange }: {
    choices: EntryChoices; value?: string; id?: string; label: string; collectionLabel: string;
    clearLabel?: string; unresolved?: string; invalid?: boolean; describedby?: string | undefined; onchange?: (() => void) | undefined;
  } = $props();
  let query = $state(''), open = $state(false);
  let table = $state<VirtualTable>();
  const selected = $derived(choices.byId.get(value));
</script>

<Popover {label} width={380} align="end" onopen={() => { query = ''; open = true; }} onclose={() => { open = false; }}>
  {#snippet trigger(popup)}
    <button {id} type="button" class="c-select" aria-label={label} popovertarget={popup}
      role="combobox" aria-expanded={open} aria-haspopup="dialog" aria-controls={popup}
      aria-invalid={invalid || undefined} aria-describedby={describedby}
      onkeydown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); document.getElementById(popup)?.showPopover(); } }}>
      <span>{selected ? `${selected.label}${selected.name ? ` — ${selected.name}` : ''}` : (unresolved ?? value) ? `Unresolved (${unresolved ?? value})` : 'Choose…'}</span>
      <Icon name="chevron" />
    </button>
  {/snippet}
  {#snippet children(close)}
    {#if open}
      {#if clearLabel}<button type="button" class="clear-choice" onclick={() => { value = ''; onchange?.(); close(); }}>{clearLabel}</button>{/if}
      <div class="picker-search">
        <SearchField label={`Find ${collectionLabel.toLowerCase()}`} bind:value={query} onkeydown={event => {
          if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); table?.focus(); }
        }} />
      </div>
      <div class="picker-results">
        <VirtualTable bind:this={table} source={choices.source} columns={entryColumns} {query} label={collectionLabel} identity={{ label: 'ID', width: 96 }}
          bind:selected={() => selected?.id ?? null, key => {
            if (key !== null && choices.byId.has(key)) { value = key; onchange?.(); close(); }
          }} emptyText={`No matching ${collectionLabel.toLowerCase()}.`} />
      </div>
    {/if}
  {/snippet}
</Popover>

<style>
  .clear-choice { flex: none; margin: var(--spacing-xs); text-align: left; }
  .picker-search { flex: none; padding: 8px; border-bottom: 1px solid var(--color-border); }
  .picker-results { height: 280px; min-height: 0; flex: 0 1 280px; }
</style>
