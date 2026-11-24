<script lang="ts">
  import { onMount } from 'svelte';
  import { View, symbol, type Marker, type Scene } from 'latkit';
  import { latkit } from '../ui/latkit.js';
  import LengthInput from '../ui/LengthInput.svelte';

  import ExpressionInput from './ExpressionInput.svelte';
  import type { InputIssue } from './expression-input.js';

  type SymbolOptions = Extract<Marker, { symbol: unknown }>['symbol'];
  let { spec, name, onchange, onissue }: { spec: SymbolOptions; name: string; onissue: InputIssue; onchange: (spec: SymbolOptions) => void } = $props();
  let canvas: HTMLCanvasElement;
  let view = $state.raw<View>();
  let fault = $state('');
  const preview = $derived.by((): Scene => {
    // Use each path once. Field-driven indices on the case do not apply to this local table.
    const indices = spec.paths.map((_, index) => index);
    return { space: 'plane', ease: 0, controls: 'none',
      tables: { Symbols: { fields: { x: indices, index: indices } } },
      marks: [{ vertices: 'Symbols', position: ['$x', 0], radius: 10, color: '#377da6',
        marker: symbol(spec.paths, { index: '$index', ...spec.stroke != null && { stroke: spec.stroke } }) }],
    };
  });
  onMount(() => {
    const abort = new AbortController();
    let opened: View | undefined;
    void (async () => {
      try {
        const gpu = await latkit();
        abort.signal.throwIfAborted();
        opened = await View.create(canvas, preview, { gpu, signal: abort.signal });
        if (abort.signal.aborted) { opened.destroy(); return; }
        view = opened;
        const report = () => { fault = opened!.failures.map(entry => entry.message).join('. '); };
        opened.on('failures', report);
        report();
      } catch (cause) { if (!abort.signal.aborted) fault = String(cause); }
    })();
    return () => { abort.abort(); opened?.destroy(); };
  });
  $effect(() => {
    if (!view) return;
    view.scene = preview;
    void view.fit().catch(() => {});
  });
</script>

<canvas bind:this={canvas} aria-label={name + ' preview'}></canvas>
{#if fault}<span role="status">{fault}</span>{/if}
<label>SVG paths <textarea aria-label={name + ' SVG paths, one per line'} value={spec.paths.join('\n')}
  onchange={({ currentTarget }) => {
    const paths = currentTarget.value.split('\n').map(path => path.trim()).filter(Boolean);
    if (paths.length) onchange({ ...spec, paths }); else currentTarget.value = spec.paths.join('\n');
  }}></textarea></label>
<label>Path index <ExpressionInput label={name + ' path index'} value={spec.index} kind="index" placeholder="0 or field" {onissue}
  onchange={index => { const { index: _, ...base } = spec; onchange(index === undefined ? base : { ...base, index }); }} /></label>
<label>Outline <input aria-label={name + ' outline'} type="checkbox" checked={spec.stroke != null}
  onchange={({ currentTarget }) => onchange({ ...spec, stroke: currentTarget.checked ? 1 : null })} /></label>
{#if spec.stroke != null}
  <LengthInput label={name + ' stroke width'} min={Number.MIN_VALUE} value={spec.stroke} onchange={stroke => onchange({ ...spec, stroke })} />
{/if}

<style>
  canvas { width: 100%; height: 3rem; }
  label { display: grid; grid-template-columns: 1fr 1.4fr; align-items: center; gap: var(--spacing-sm); margin-block: var(--spacing-xs); }
  input, textarea { min-width: 0; }
</style>
