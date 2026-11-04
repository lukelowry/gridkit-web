<script lang="ts">
  import type { PreferenceField } from './definitions.js';
  let { preference, value, label, id, onchange }: {
    preference: PreferenceField; value: string | number | boolean; label: string; id: string;
    onchange: (value: unknown) => void;
  } = $props();
  const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  /** A choice's options in order, those sharing a heading in a run beneath it. */
  const runs = $derived.by(() => {
    if (preference.kind !== 'choice') return [];
    const { options, groups } = preference, all: { group: string | undefined; options: string[] }[] = [];
    for (const option of options) {
      const group = groups[option], last = all.at(-1);
      if (last && last.group === group) last.options.push(option);
      else all.push({ group, options: [option] });
    }
    return all;
  });
</script>

{#if preference.kind === 'boolean'}
  <input {id} type="checkbox" aria-label={label} checked={value === true} onchange={event => onchange(event.currentTarget.checked)} />
{:else if preference.kind === 'choice'}
  <select {id} aria-label={label} value={String(value)} onchange={event => onchange(event.currentTarget.value)}>
    {#each runs as run, index (index)}
      {#if run.group}<optgroup label={run.group}>{#each run.options as option (option)}<option value={option}>{preference.labels[option] ?? title(option)}</option>{/each}</optgroup>
      {:else}{#each run.options as option (option)}<option value={option}>{preference.labels[option] ?? title(option)}</option>{/each}{/if}
    {/each}
  </select>
{:else if preference.kind === 'number'}
  <span class="c-field">
    <input {id} type="number" aria-label={label} min={preference.min} max={preference.max} step={preference.step} value={Number(value)}
      onchange={event => {
        const input = event.currentTarget;
        let next = Number.isFinite(input.valueAsNumber) ? Math.min(preference.max, Math.max(preference.min, input.valueAsNumber)) : Number(value);
        if (preference.step === 1) next = Math.round(next);
        onchange(next); input.value = String(next);
      }} />
    {#if preference.unit}<span class="c-field__suffix">{preference.unit}</span>{/if}
  </span>
{:else if preference.kind === 'color'}
  <div class="c-color-field">
    <input type="color" aria-label={`${label} picker`} value={String(value).slice(0, 7) || '#808080'}
      oninput={event => onchange(event.currentTarget.value)} />
    <input {id} aria-label={label} placeholder="Theme" value={String(value)} spellcheck="false"
      pattern="(|#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)" maxlength="9"
      onchange={event => {
        const input = event.currentTarget;
        if (input.reportValidity()) onchange(input.value); else input.value = String(value);
      }} />
  </div>
{:else if preference.kind === 'url'}
  <input {id} type="url" aria-label={label} placeholder="https://" value={String(value)} spellcheck="false"
    oninput={event => event.currentTarget.setCustomValidity('')}
    onchange={event => {
      const input = event.currentTarget;
      const result = preference.schema.safeParse(input.value.trim());
      input.setCustomValidity(result.success ? '' : 'Enter an HTTP or HTTPS GeoJSON URL.');
      if (input.reportValidity() && result.success) onchange(result.data);
    }} />
{:else}
  <input {id} aria-label={label} placeholder="IBM Plex Sans" value={String(value)} maxlength="200"
    onchange={event => onchange(event.currentTarget.value)} />
{/if}
