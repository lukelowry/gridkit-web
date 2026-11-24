<script lang="ts">
  import type { Length } from 'latkit';
  let { label, value, onchange, id, disabled = false, min, max }: {
    label: string; value: Length; onchange: (value: Length) => void;
    id?: string; disabled?: boolean; min?: number | undefined; max?: number | undefined;
  } = $props();
  const world = $derived(typeof value === 'object');
  const amount = $derived(typeof value === 'number' ? value : value.units);
  const lower = $derived(world && min !== undefined && min > 0 ? Number.MIN_VALUE : min);
</script>

<span class="length">
  <input {id} {disabled} aria-label={label} type="number" step="any" min={lower} max={world ? undefined : max} value={amount}
    onchange={({ currentTarget: input }) => {
      if (input.value && input.validity.valid) onchange(world ? { units: input.valueAsNumber } : input.valueAsNumber);
      else input.value = String(amount);
    }} />
  <select {disabled} aria-label={label + ' units'} value={world ? 'units' : 'px'}
    onchange={({ currentTarget }) => onchange(currentTarget.value === 'units' ? { units: amount } : Math.min(max ?? Infinity, Math.max(min ?? -Infinity, amount)))}>
    <option value="px">px</option><option value="units">Drawing units</option>
  </select>
</span>

<style>
  .length { display: flex; gap: var(--spacing-xs); min-width: 0; }
  input, select { min-width: 0; flex: 1; }
</style>
