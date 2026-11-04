<script lang="ts">
  import type { FieldDraft } from './field-drafts.js';
  let { fields = $bindable(), label, group, errors = {} }: {
    fields: FieldDraft[]; label: string; group: string; errors?: Readonly<Record<string, string>>;
  } = $props();
  const id = $props.id();
</script>

{#each fields as field, index (field.key)}
  {@const error = errors[`${group}.${field.key}`]}
  {@const description = [field.unit ? `${id}-${index}-unit` : '', error ? `${id}-${index}-error` : ''].filter(Boolean).join(' ') || undefined}
  <div class="property-row" data-field={`${group}.${field.key}`}>
    <label for={`${id}-${index}`} title={field.key}>{field.label}{#if field.unit}<span class="field-unit" id={`${id}-${index}-unit`}>{field.unit}</span>{/if}</label>
    <div class="property-control property-field">
      {#if field.choices}
        <select id={`${id}-${index}`} aria-label={`${label} ${field.label}`} bind:value={field.text}
          aria-invalid={!!error || undefined} aria-describedby={description}>
          <option value="">Not set</option>
          {#if field.text && !field.choices.includes(field.text)}<option value={field.text}>{field.text}</option>{/if}
          {#each field.choices as choice (choice)}<option value={choice}>{choice}</option>{/each}
        </select>
      {:else if field.kind === 'boolean' && field.missing}
        <select id={`${id}-${index}`} aria-label={`${label} ${field.label}`} bind:value={field.text}>
          <option value="">Not set</option><option value="true">True</option><option value="false">False</option>
        </select>
      {:else if field.kind === 'boolean'}
        <input id={`${id}-${index}`} type="checkbox" aria-label={`${label} ${field.label}`}
          checked={field.text === 'true'} onchange={event => { field.text = String(event.currentTarget.checked); }} />
      {:else if field.kind === 'json'}
        <textarea id={`${id}-${index}`} aria-label={`${label} ${field.label}`} rows="4" spellcheck="false"
          aria-invalid={!!error || undefined} aria-describedby={description} bind:value={field.text}></textarea>
      {:else}
        <input id={`${id}-${index}`} aria-label={`${label} ${field.label}`} type={field.kind === 'number' ? 'number' : 'text'}
          step="any" value={field.text} placeholder="Not set"
          aria-invalid={!!error || undefined} aria-describedby={description}
          oninput={event => { field.text = event.currentTarget.value; }} />
      {/if}
      {#if error}<p class="field-error" id={`${id}-${index}-error`}>{error}</p>{/if}
    </div>
  </div>
{:else}
  <p class="property-empty">No {label.toLowerCase()}.</p>
{/each}

<style>
  textarea { font-family: var(--font-mono); }
</style>
