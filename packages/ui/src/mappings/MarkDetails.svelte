<script lang="ts">
  import { symbol, type Length, type Marker, type Place } from 'latkit';
  import { record, type FieldInfo } from '@gridkit/library';
  import type { MappingOptions, MarkKind } from '../domain/views.js';
  import MarkValue from './MarkValue.svelte';
  import SymbolEditor from './SymbolEditor.svelte';
  import LengthInput from '../ui/LengthInput.svelte';

  let { kind, options, fields, labelSize, onchange }: {
    kind: MarkKind; options: Record<string, unknown>; fields: readonly FieldInfo[]; labelSize: number;
    onchange: (key: keyof MappingOptions, value: unknown) => void;
  } = $props();
  let open = $state(false);
  const markerOptions = (entry: unknown): Record<string, unknown> => record(entry) ?? { marker: entry };
  const shapes = ['ellipse', 'rectangle', 'rounded', 'diamond'] as const;
  const places: Place[] = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const ring = 'a.55 .55 0 1 0 0 1.1a.55 .55 0 1 0 0-1.1z';
  const transformer = symbol('M0 -.9' + ring + ' M0 -.2' + ring, { stroke: 1.5 });
  const markers = $derived(Array.isArray(options.markers) ? options.markers : []);
  const label = $derived.by((): Record<string, unknown> => {
    const value = record(options.label);
    return value && 'text' in value ? value : { text: options.label };
  });
  const place = $derived(typeof label.place === 'string' ? label.place : '');
  const offsets = $derived(Array.isArray(label.offset) ? label.offset : [0, 0]);
  const defaultSymbol = 'M0 -1L1 0L0 1L-1 0Z';
  function symbolOf(marker: unknown) {
    const spec = record(record(marker)?.symbol);
    return Array.isArray(spec?.paths) && spec.paths.length && spec.paths.every(path => typeof path === 'string')
      ? spec as Extract<Marker, { symbol: unknown }>['symbol'] : null;
  }
  const vertexSymbol = $derived(symbolOf(options.marker));
  const nativeLength = (value: unknown, base: number): Length => typeof value === 'number' ? value :
    typeof record(value)?.units === 'number' ? { units: Number(record(value)!.units) } : base;
  function changeLabel(key: string, value: unknown) {
    const next = { ...label, [key]: value };
    if (value === undefined) delete next[key];
    onchange('label', next);
  }
  function editMarker(index: number, key: string, value: unknown) {
    const next: Record<string, unknown> = { ...markerOptions(markers[index]), [key]: value };
    if (value === undefined) delete next[key];
    onchange('markers', markers.map((marker, i) => i === index ? next : marker));
  }
  const transition = $derived(options.blend == null ? 'auto' : Array.isArray(options.blend) ? 'gradual' : 'sharp');
  const stops = $derived(Array.isArray(options.blend) ? options.blend : [0, 1]);
  const properties = [
    { key: 'at', title: 'Position', kind: 'fraction', hint: '0 to 1' },
    { key: 'offset', title: 'Offset', kind: 'offset', hint: '0' },
    { key: 'size', title: 'Size', kind: 'size', hint: 'Auto' },
    { key: 'color', title: 'Color', kind: 'color', hint: 'Endpoint color' },
    { key: 'visible', title: 'Visible', kind: 'visible', hint: 'true' },
  ] as const;
</script>

<details class="mark-details" bind:open>
  <summary>{kind === 'vertices' ? 'Symbol and label' : 'Branch symbols and labels'}</summary>
  {#if open}
    {#if kind === 'vertices'}
      <label>Bus display
        <select value={vertexSymbol ? 'symbol' : options.marker === 'none' ? 'none' : 'shape'}
          onchange={({ currentTarget }) => onchange('marker', currentTarget.value === 'symbol' ? symbol(defaultSymbol) : currentTarget.value === 'none' ? 'none' : 'ellipse')}>
          <option value="shape">Shape</option><option value="none">Label only</option><option value="symbol">SVG path</option>
        </select>
      </label>
      {#if vertexSymbol}
        <SymbolEditor name="Bus symbol" spec={vertexSymbol} onchange={symbol => onchange('marker', { symbol })} />
      {/if}
    {:else}
      <label>Edge attachment <select value={String(options.meet ?? 'center')} onchange={({ currentTarget }) => onchange('meet', currentTarget.value)}>
        <option value="center">Center</option><option value="nearest">Nearest outline</option>
      </select></label>
      <label>Endpoint color transition
        <select value={transition} onchange={({ currentTarget }) => onchange('blend',
          currentTarget.value === 'auto' ? undefined : currentTarget.value === 'sharp' ? 0.5 : [0, 1])}>
          <option value="auto">Default</option><option value="sharp">Sharp change</option><option value="gradual">Gradual blend</option>
        </select>
      </label>
      {#if transition === 'sharp'}
        <div class="row"><span>Change at</span><MarkValue label="Color change position" kind="fraction" value={options.blend} onchange={v => onchange('blend', v)} /></div>
      {:else if transition === 'gradual'}
        {#each ['Start', 'End'] as title, i (title)}
          <div class="row"><span>{title}</span><MarkValue label={'Blend ' + title} kind="fraction" value={stops[i]}
            onchange={v => onchange('blend', stops.map((n, j) => i === j ? v ?? i : n))} /></div>
        {/each}
      {/if}
      {#each markers as entry, i (i)}
        {@const item = markerOptions(entry)}
        {@const spec = symbolOf(item.marker)}
        <fieldset><legend>Branch marker {i + 1}</legend>
          <label>Shape <select value={typeof item.marker === 'string' ? item.marker : JSON.stringify(item.marker) === JSON.stringify(transformer) ? 'transformer' : 'custom'}
            onchange={({ currentTarget }) => editMarker(i, 'marker', currentTarget.value === 'transformer' ? transformer : currentTarget.value === 'path' ? symbol(defaultSymbol) : currentTarget.value)}>
            {#each shapes as shape (shape)}<option value={shape}>{shape}</option>{/each}
            <option value="transformer">Transformer</option><option value="path">Custom SVG path</option>{#if typeof item.marker !== 'string'}<option value="custom">Symbol</option>{/if}
          </select></label>
          {#if spec}
            <SymbolEditor name={'Marker ' + (i + 1)} {spec} onchange={symbol => editMarker(i, 'marker', { symbol })} />
          {/if}
          {#each properties as property (property.key)}
            <div class="row"><span>{property.title}</span><MarkValue label={'Marker ' + (i + 1) + ' ' + property.title} kind={property.kind}
              value={item[property.key]} placeholder={property.hint} onchange={v => editMarker(i, property.key, v)} /></div>
          {/each}
          <button type="button" onclick={() => onchange('markers', markers.filter((_, j) => j !== i))}>Remove marker</button>
        </fieldset>
      {/each}
      <button type="button" disabled={markers.length >= 4} onclick={() => onchange('markers', [...markers, { marker: 'rectangle', at: 0.5 }])}>Add branch marker</button>
    {/if}
    {#if label.text != null}
      <label>Label position <select value={place} onchange={({ currentTarget }) => changeLabel('place', currentTarget.value || undefined)}>
        <option value="">Automatic</option>
        {#each places as side (side)}<option value={side}>{side}</option>{/each}
        {#each fields.filter(field => field.kind === 'text') as field (field.id)}<option value={'$' + field.id}>{field.label} (field)</option>{/each}
      </select></label>
      <div class="row"><span>Label size</span><LengthInput label="Label size" min={Number.MIN_VALUE} value={nativeLength(label.size, labelSize)} onchange={value => changeLabel('size', value)} /></div>
      {#each ['X', 'Y'] as axis, i (axis)}
        <div class="row"><span>{axis} offset</span><MarkValue kind="offset" label={'Label ' + axis + ' offset'} value={offsets[i]}
          onchange={value => changeLabel('offset', offsets.map((current, index) => i === index ? value ?? 0 : current))} /></div>
      {/each}
    {/if}
  {/if}
</details>

<style>
  .mark-details { margin: var(--spacing-sm) 0; }
  label, .row { display: grid; grid-template-columns: minmax(6rem, 1fr) minmax(0, 1.4fr); gap: var(--spacing-sm); align-items: center; margin-block: var(--spacing-xs); }
  select { width: 100%; min-width: 0; }
  fieldset { margin-block: var(--spacing-sm); padding: var(--spacing-sm); border: 1px solid var(--color-border); }
</style>
