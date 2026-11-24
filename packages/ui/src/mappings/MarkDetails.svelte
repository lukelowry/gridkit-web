<script lang="ts">
  import { symbol, type ExprInput, type Label, type Marker, type Place, type StrokeMarker } from 'latkit';
  import type { FieldInfo } from '@gridkit/library';
  import type { MappingOptions, Properties } from '../domain/views.js';
  import ExpressionInput from './ExpressionInput.svelte';
  import type { InputIssue } from './expression-input.js';
  import MarkValue from './MarkValue.svelte';
  import SymbolEditor from './SymbolEditor.svelte';
  import LengthInput from '../ui/LengthInput.svelte';

  type DetailOptions = { vertices: 'marker'; edges: 'markers' | 'blend' | 'meet' };
  type Editor = { [K in keyof DetailOptions]: {
    kind: K; options: Properties<K>;
    set: <P extends DetailOptions[K]>(key: P, value: Required<MappingOptions>[P] | undefined) => void;
  } }[keyof DetailOptions];
  let { editor, fields, labelSize, onissue, onlabel }: { editor: Editor; fields: readonly FieldInfo[]; labelSize: number; onissue: InputIssue; onlabel: (label: Label) => void } = $props();
  let open = $state(false);
  type MarkerEntry = Exclude<StrokeMarker, string>;
  const markerOptions = (entry: StrokeMarker): MarkerEntry => typeof entry === 'string' ? { marker: entry } : entry;
  const shapes = ['ellipse', 'rectangle', 'rounded', 'diamond'] as const;
  const places: Place[] = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const ring = 'a.55 .55 0 1 0 0 1.1a.55 .55 0 1 0 0-1.1z';
  const transformer = symbol('M0 -.9' + ring + ' M0 -.2' + ring, { stroke: 1.5 });
  const markers = $derived(editor.kind === 'edges' ? editor.options.markers ?? [] : []);
  type LabelStyle = Extract<Label, { text: ExprInput }>;
  const label = $derived.by((): LabelStyle => {
    const value = editor.options.label;
    return value && typeof value === 'object' && 'text' in value ? value : { text: value ?? null };
  });
  const place = $derived(label.place ?? '');
  const offsets = $derived(label.offset ?? [0, 0]);
  const defaultSymbol = 'M0 -1L1 0L0 1L-1 0Z';
  function symbolOf(marker: Marker | null | undefined) {
    return marker && typeof marker === 'object' && 'symbol' in marker ? marker.symbol : null;
  }
  const vertexSymbol = $derived(editor.kind === 'vertices' ? symbolOf(editor.options.marker) : null);
  function changeLabel<P extends keyof LabelStyle>(key: P, value: LabelStyle[P]) {
    const next = { ...label };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onlabel(next);
  }
  function editMarker<P extends keyof MarkerEntry>(index: number, key: P, value: MarkerEntry[P]) {
    if (editor.kind !== 'edges') return;
    const next = { ...markerOptions(markers[index]!) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    editor.set('markers', markers.map((entry, i) => i === index ? next : entry));
  }
  function shape(value: string): Marker {
    if (value === 'transformer') return transformer;
    if (value === 'path') return symbol(defaultSymbol);
    return shapes.find(shape => shape === value) ?? 'rectangle';
  }
  const blend = $derived(editor.kind === 'edges' ? editor.options.blend : undefined);
  const transition = $derived(blend == null ? 'auto' : Array.isArray(blend) ? 'gradual' : 'sharp');
  const stops = $derived(Array.isArray(blend) ? blend : [0, 1] as const);
  const properties = [
    { key: 'at', title: 'Position', kind: 'fraction', hint: '0 to 1' },
    { key: 'offset', title: 'Offset', kind: 'offset', hint: '0' },
    { key: 'size', title: 'Size', kind: 'size', hint: 'Auto' },
    { key: 'color', title: 'Color', kind: 'color', hint: 'Endpoint color' },
    { key: 'visible', title: 'Visible', kind: 'visible', hint: 'true' },
  ] as const;
</script>

<details class="mark-details" bind:open>
  <summary>{editor.kind === 'vertices' ? 'Symbol and label' : 'Branch symbols and labels'}</summary>
  {#if open}
    {@const current = editor}
    {#if current.kind === 'vertices'}
      <label>Bus display
        <select value={vertexSymbol ? 'symbol' : current.options.marker === 'none' ? 'none' : 'shape'}
          onchange={({ currentTarget }) => current.set('marker', currentTarget.value === 'symbol' ? symbol(defaultSymbol) : currentTarget.value === 'none' ? 'none' : 'ellipse')}>
          <option value="shape">Shape</option><option value="none">Label only</option><option value="symbol">SVG path</option>
        </select>
      </label>
      {#if vertexSymbol}
        <SymbolEditor {onissue} name="Bus symbol" spec={vertexSymbol} onchange={symbol => current.set('marker', { symbol })} />
      {/if}
    {:else}
      <label>Edge attachment <select value={String(current.options.meet ?? 'center')} onchange={({ currentTarget }) => current.set('meet', currentTarget.value === 'nearest' ? 'nearest' : 'center')}>
        <option value="center">Center</option><option value="nearest">Nearest outline</option>
      </select></label>
      <label>Endpoint color transition
        <select value={transition} onchange={({ currentTarget }) => current.set('blend',
          currentTarget.value === 'auto' ? undefined : currentTarget.value === 'sharp' ? 0.5 : [0, 1])}>
          <option value="auto">Default</option><option value="sharp">Sharp change</option><option value="gradual">Gradual blend</option>
        </select>
      </label>
      {#if transition === 'sharp'}
        <div class="row"><span>Change at</span><ExpressionInput {onissue} placeholder="0.5" label="Color change position" kind="fraction" value={blend} onchange={v => current.set('blend', v)} /></div>
      {:else if transition === 'gradual'}
        {#each ['Start', 'End'] as title, i (title)}
          <div class="row"><span>{title}</span><ExpressionInput {onissue} placeholder={String(i)} label={'Blend ' + title} kind="fraction" value={stops[i]}
            onchange={v => current.set('blend', i === 0 ? [v ?? 0, stops[1]] : [stops[0], v ?? 1])} /></div>
        {/each}
      {/if}
      {#each markers as entry, i (i)}
        {@const item = markerOptions(entry)}
        {@const spec = symbolOf(item.marker)}
        <fieldset><legend>Branch marker {i + 1}</legend>
          <label>Shape <select value={typeof item.marker === 'string' ? item.marker : JSON.stringify(item.marker) === JSON.stringify(transformer) ? 'transformer' : 'custom'}
            onchange={({ currentTarget }) => editMarker(i, 'marker', shape(currentTarget.value))}>
            {#each shapes as shape (shape)}<option value={shape}>{shape}</option>{/each}
            <option value="transformer">Transformer</option><option value="path">Custom SVG path</option>{#if typeof item.marker !== 'string'}<option value="custom">Symbol</option>{/if}
          </select></label>
          {#if spec}
            <SymbolEditor {onissue} name={'Marker ' + (i + 1)} {spec} onchange={symbol => editMarker(i, 'marker', { symbol })} />
          {/if}
          {#each properties as property (property.key)}
            <div class="row"><span>{property.title}</span>{#if property.key === 'size' || property.key === 'offset'}
              <MarkValue {onissue} label={'Marker ' + (i + 1) + ' ' + property.title} kind={property.key}
                value={item[property.key]} placeholder={property.hint} onchange={v => editMarker(i, property.key, v)} />
            {:else}
              <ExpressionInput {onissue} label={'Marker ' + (i + 1) + ' ' + property.title} kind={property.kind}
                value={item[property.key]} placeholder={property.hint} onchange={v => editMarker(i, property.key, v)} />
            {/if}</div>
          {/each}
          <button type="button" onclick={() => current.set('markers', markers.filter((_, j) => j !== i))}>Remove marker</button>
        </fieldset>
      {/each}
      <button type="button" disabled={markers.length >= 4} onclick={() => current.set('markers', [...markers, { marker: 'rectangle', at: 0.5 }])}>Add branch marker</button>
    {/if}
    {#if label.text != null}
      <label>Label position <select value={place} onchange={({ currentTarget }) => changeLabel('place', places.find(side => side === currentTarget.value) ?? fields.map(field => `$${field.id}` as const).find(id => id === currentTarget.value))}>
        <option value="">Automatic</option>
        {#each places as side (side)}<option value={side}>{side}</option>{/each}
        {#each fields.filter(field => field.kind === 'text') as field (field.id)}<option value={'$' + field.id}>{field.label} (field)</option>{/each}
      </select></label>
      <div class="row"><span>Label size</span><LengthInput label="Label size" min={Number.MIN_VALUE} value={label.size ?? labelSize} onchange={value => changeLabel('size', value)} /></div>
      {#each ['X', 'Y'] as axis, i (axis)}
        <div class="row"><span>{axis} offset</span><MarkValue {onissue} kind="offset" label={'Label ' + axis + ' offset'} value={offsets[i]}
          onchange={value => changeLabel('offset', i === 0 ? [value ?? 0, offsets[1]] : [offsets[0], value ?? 0])} /></div>
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
