<script lang="ts">
  import { fieldGroup, type FieldInfo } from '@gridkit/library';
  import { fieldCompatible, type OptionControl } from './encoding.js';
  import SearchField from '../ui/SearchField.svelte';
  /** The fields an option can read, under its own `choices` while nothing is searched for. */
  let { fields, choices, value, control, label, onchange, allowMissing = false }: {
    fields: readonly FieldInfo[]; choices: readonly { readonly id: string; readonly label: string; readonly detail?: string }[]; value: string;
    control: OptionControl; label: string; onchange: (value: string) => void; allowMissing?: boolean;
  } = $props();
  let query = $state('');
  let results = $state<HTMLDivElement>();
  const shown = $derived(fields.filter(field => fieldCompatible(field, control) && `${field.id} ${field.label} ${field.unit ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = $derived(['Simulation', 'Parameters', 'Initial values', 'Identity'].map(label => ({ label, fields: shown.filter(field => fieldGroup(field.id) === label) })).filter(group => group.fields.length));
</script>

<div class="picker-search"><SearchField label={`Find ${label.toLowerCase()} fields`} bind:value={query} onkeydown={event => {
  if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); results?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
}} /></div>
<div class="picker-results" bind:this={results}>
  {#if !query}
    {#each choices as choice (choice.id)}
      <button type="button" class="choice" aria-pressed={value === choice.id} onclick={() => onchange(choice.id)}>{choice.label}{#if choice.detail}<span>{choice.detail}</span>{/if}</button>
    {/each}
    <div class="separator"></div>
  {/if}
  {#each groups as group (group.label)}
    <div role="group" aria-label={group.label}>
      <h4>{group.label}</h4>
      {#each group.fields as field (field.id)}
        <button type="button" class="choice" aria-pressed={value === field.id} disabled={!allowMissing && field.presence.present === 0}
          title={`${field.presence.present} of ${field.presence.total} values`} onclick={() => onchange(field.id)}>
          {field.label}<span>{field.presence.present === 0 ? 'No values' : field.unit ?? ''}</span>
        </button>
      {/each}
    </div>
  {:else}<p class="property-empty">No matching source data.</p>{/each}
</div>

<style>
  .picker-search { padding: var(--spacing-sm); border-bottom: 1px solid var(--color-border); }
  .picker-results { overflow: auto; max-height: 15rem; padding: var(--spacing-xs); }
  .picker-results h4 { margin: 0; padding: var(--spacing-xs) var(--spacing-sm) var(--spacing-2xs); color: var(--color-text-3); font: var(--type-caption); }
  .choice { display: flex; align-items: center; gap: var(--spacing-sm); width: 100%; min-height: var(--control-height); text-align: left; padding: var(--spacing-xs) var(--spacing-sm); font: var(--type-control); }
  .choice span { margin-left: auto; min-width: 0; overflow: hidden; color: var(--color-text-3); font: var(--type-caption); white-space: nowrap; text-overflow: ellipsis; }
  .choice[aria-pressed="true"] { background: var(--color-selected); color: var(--color-primary-text); font-weight: 500; }
  .choice[aria-pressed="true"] span { color: inherit; }
  .separator { border-top: 1px solid var(--color-border); margin: var(--spacing-xs) var(--spacing-sm); }
  .property-empty { padding: var(--spacing-sm); }
</style>
