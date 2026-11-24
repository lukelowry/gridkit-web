<script lang="ts">
  import { colorHex } from '../ui/color.js';
  import type { CustomColormap } from 'latkit';
  let { map, numeric, onchange }: { map: CustomColormap; numeric: boolean; onchange: (map: CustomColormap) => void } = $props();
  const values = $derived(map.values ?? []);
  const labels = $derived(map.categories ?? values.map(String));
  function change(index: number, value: string | number, label: string, color: CustomColormap['colors'][number]) {
    const next = [...values], names = [...labels], colors = [...map.colors];
    next[index] = value; names[index] = label; colors[index] = color;
    onchange({ ...map, values: next, categories: names, colors });
  }
  function append() {
    let n = values.length + 1;
    while (values.includes(numeric ? n : 'Category ' + n)) n++;
    change(values.length, numeric ? n : 'Category ' + n, numeric ? String(n) : 'Category ' + n, '#0072b2');
  }
</script>
{#each values as value, i (i)}
  <div class="category">
    <input aria-label={'Category ' + (i+1) + ' value'} type={numeric ? 'number' : 'text'} step="any" value={value}
      onchange={({ currentTarget: el }) => {
        const next = numeric ? el.valueAsNumber : el.value;
        if ((numeric && !Number.isFinite(next)) || values.some((v, j) => j !== i && v === next)) { el.value = String(value); return; }
        change(i, next, labels[i] === String(value) ? String(next) : labels[i]!, map.colors[i]!);
      }} />
    <input aria-label={'Category ' + (i+1) + ' label'} value={labels[i]} onchange={({ currentTarget }) => change(i, value, currentTarget.value, map.colors[i]!)} />
    <input aria-label={'Category ' + (i+1) + ' color'} type="color" value={colorHex(String(map.colors[i])) ?? '#808080'}
      oninput={({ currentTarget }) => change(i, value, labels[i]!, currentTarget.value)} />
    <button type="button" aria-label={'Remove category ' + (i+1)} disabled={values.length === 1} onclick={() => onchange({ ...map,
      values: values.filter((_, j) => j !== i), categories: labels.filter((_, j) => j !== i), colors: map.colors.filter((_, j) => j !== i) })}>−</button>
  </div>
{/each}
<button type="button" disabled={values.length >= 256} onclick={append}>Add category</button>
<style>
  .category { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: var(--spacing-xs); }
  input { min-width: 0; width: 100%; }
</style>
