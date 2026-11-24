<script lang="ts">
  import { record } from '@gridkit/library';
  let { label, value, kind, placeholder = '', onchange }: {
    label: string; value: unknown; kind: 'fraction' | 'size' | 'offset' | 'color' | 'visible';
    placeholder?: string; onchange: (value: unknown) => void;
  } = $props();
  const sized = $derived(kind === 'size' || kind === 'offset');
  const length = $derived(sized ? record(value) : null);
  const world = $derived(length?.units !== undefined);
  const amount = $derived(world ? length?.units : value);
  const text = $derived(amount == null ? '' : typeof amount === 'string' ? amount : JSON.stringify(amount));
  function change(input: HTMLInputElement) {
    const raw = input.value.trim();
    try {
      if (!raw) { onchange(undefined); return; }
      let next: unknown;
      try { next = JSON.parse(raw); }
      catch {
        if (!raw.startsWith('$') && !(kind === 'color' && CSS.supports('color', raw))) throw new Error('Enter a value or a field starting with $.');
        next = raw;
      }
      if (typeof next === 'number' && (!Number.isFinite(next) || kind === 'fraction' && (next < 0 || next > 1) || kind === 'size' && next < 0))
        throw new Error(kind === 'fraction' ? 'Use a fraction from 0 to 1.' : 'Enter a valid size.');
      onchange(world ? { ...length, units: next } : next);
    } catch (error) {
      input.value = text;
      input.setCustomValidity(error instanceof Error ? error.message : 'Invalid value.');
      input.reportValidity();
    }
  }
</script>

<span class="value">
  <input aria-label={label} value={text} {placeholder} oninput={({ currentTarget }) => currentTarget.setCustomValidity('')}
    onchange={({ currentTarget }) => change(currentTarget)} />
  {#if sized}
    <select aria-label={label + ' units'} value={world ? 'units' : 'px'}
      onchange={({ currentTarget }) => onchange(currentTarget.value === 'units' ? { units: amount ?? (kind === 'size' ? 1 : 0) } : amount)}>
      <option value="px">px</option><option value="units">Drawing units</option>
    </select>
  {/if}
</span>

<style>
  .value { display: flex; gap: var(--spacing-xs); min-width: 0; }
  input, select { flex: 1; min-width: 0; }
</style>
