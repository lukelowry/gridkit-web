<script lang="ts">
  import type { ConnectionChoices } from './connection-choices.js';
  import EntryPicker from '../table/EntryPicker.svelte';

  let { choices, value = $bindable(''), id, label, collectionLabel, invalid = false, describedby, onchange }: {
    choices: ConnectionChoices; value?: string; id: string; label: string; collectionLabel: string;
    invalid?: boolean; describedby?: string | undefined; onchange?: () => void;
  } = $props();
</script>

<EntryPicker {choices} bind:value {id} {label} {collectionLabel} {invalid} {describedby} {onchange} clearLabel="Unconnected" />
