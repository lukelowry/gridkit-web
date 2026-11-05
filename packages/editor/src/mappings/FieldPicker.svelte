<script lang="ts">
  import { fieldGroup, type FieldInfo } from '@gridkit/library';
  import { fieldCompatible, type OptionControl } from './encoding.js';
  import PickerPanel from '../ui/PickerPanel.svelte';
  import ChoiceRow from '../ui/ChoiceRow.svelte';
  /** The fields an option can read, under its own `choices` while nothing is searched for. */
  let { fields, choices, value, control, label, onchange, allowMissing = false }: {
    fields: readonly FieldInfo[]; choices: readonly { readonly id: string; readonly label: string; readonly detail?: string }[]; value: string;
    control: OptionControl; label: string; onchange: (value: string) => void; allowMissing?: boolean;
  } = $props();
  let query = $state('');
  const shown = $derived(fields.filter(field => fieldCompatible(field, control) && `${field.id} ${field.label} ${field.unit ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = $derived(['Simulation', 'Parameters', 'Initial values', 'Identity'].map(label => ({ label, fields: shown.filter(field => fieldGroup(field.id) === label) })).filter(group => group.fields.length));
</script>

<PickerPanel label={`Find ${label.toLowerCase()} fields`} bind:query maxHeight={240} empty={!groups.length && !!query} emptyText="No matching source data.">
  {#if !query}
    {#each choices as choice (choice.id)}
      <ChoiceRow label={choice.label} detail={choice.detail} selected={value === choice.id} onselect={() => onchange(choice.id)} />
    {/each}
  {/if}
  {#each groups as group (group.label)}
    <div class="c-choice-group" role="group" aria-label={group.label}>
      <p class="c-choice-label">{group.label}</p>
      {#each group.fields as field (field.id)}
        <ChoiceRow label={field.label} detail={field.presence.present === 0 ? 'No values' : field.unit ?? ''}
          selected={value === field.id} disabled={!allowMissing && field.presence.present === 0}
          title={`${field.presence.present} of ${field.presence.total} values`} onselect={() => onchange(field.id)} />
      {/each}
    </div>
  {/each}
</PickerPanel>
