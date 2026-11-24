<script lang="ts">
  import type { Size } from 'latkit';
  import ExpressionInput from './ExpressionInput.svelte';
  import type { InputIssue } from './expression-input.js';
  type Props = { label: string; value: Size | undefined; kind: 'size' | 'offset';
    placeholder?: string; onissue: InputIssue; onchange: (value: Size | undefined) => void };
  let { label, value, kind, placeholder = '', onchange, onissue }: Props = $props();
  const parts = $derived(value && typeof value === 'object' && 'units' in value
    ? { world: value, amount: value.units } : { world: null, amount: value });
</script>

<span class="value">
  <ExpressionInput {label} {kind} {placeholder} {onissue} value={parts.amount}
    onchange={next => onchange(parts.world && next !== undefined ? { ...parts.world, units: next } : next)} />
  <select aria-label={label + ' units'} value={parts.world ? 'units' : 'px'}
    onchange={({ currentTarget }) => onchange(currentTarget.value === 'units'
      ? { ...parts.world, units: parts.amount ?? (kind === 'size' ? 1 : 0) } : parts.amount)}>
    <option value="px">px</option><option value="units">Drawing units</option>
  </select>
</span>

<style>
  .value { display: flex; gap: var(--spacing-xs); min-width: 0; }
  select { flex: 1; min-width: 0; }
</style>
