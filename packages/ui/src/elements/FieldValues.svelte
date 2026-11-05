<script lang="ts">
  import type { FieldValue } from './fields.js';
  let { fields, label }: { fields: readonly FieldValue[]; label: string } = $props();
  const id = $props.id();
</script>

{#each fields as field, index (field.key)}
  <div class="property-row">
    <label for={id + '-' + index} title={field.key}>{field.label}{#if field.unit}<span class="field-unit" id={id + '-' + index + '-unit'}>{field.unit}</span>{/if}</label>
    <div class="property-control">
      {#if field.multiline}
        <textarea id={id + '-' + index} aria-label={label + ' ' + field.label} aria-describedby={field.unit ? id + '-' + index + '-unit' : undefined} rows="4" readonly value={field.text}></textarea>
      {:else}
        <input id={id + '-' + index} aria-label={label + ' ' + field.label} aria-describedby={field.unit ? id + '-' + index + '-unit' : undefined} readonly value={field.text} />
      {/if}
    </div>
  </div>
{:else}
  <p class="property-empty">No {label.toLowerCase()}.</p>
{/each}
<style>textarea { font-family: var(--font-mono); }</style>
