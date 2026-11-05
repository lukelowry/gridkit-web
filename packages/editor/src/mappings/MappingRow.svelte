<script lang="ts">
  import { watchNotice } from '../ui/toasts.svelte.js';
  import type { Colormap } from 'latkit';
  import type { FieldInfo } from '@gridkit/library';
  import { errorMessage } from '../ui/errors.js';
  import { sampledName } from '../simulation/sampled.js';
  import { defaultBand, fieldOf, measureOf, percentable, type Basis } from '../domain/measure.js';
  import { colorHex } from '../ui/color.js';
  import Icon from '../ui/Icon.svelte';
  import IconToggles from '../ui/IconToggles.svelte';
  import Popover from '../ui/Popover.svelte';
  import { voltagePalette } from './defaults.js';
  import { encodingOf, encodingSummary, labelNode, nodeOf, type Domain, type Encoding, type OptionControl } from './encoding.js';
  import FieldPicker from './FieldPicker.svelte';
  import SwatchRadio from '../ui/SwatchRadio.svelte';
  import type { NumericConstraint } from './numeric.js';
  import { diverges, paletteLabel, palettes, rampCss, type ColorFit } from '../ui/ramps.js';

  /** Text typed that is not yet a mapping, kept across pages until it is; Apply waits while it has an error. */
  export interface MappingDraft { readonly texts?: Readonly<Record<string, string>>; readonly error?: string }
  let { label, control, value, inherited, unset = 'None', fields, draft, ondraft, onchange, range = [3, 12], constraint, allowMissing = false, fit }: {
    label: string; control: OptionControl; value: unknown; inherited: unknown; unset?: string | undefined; fields: readonly FieldInfo[];
    draft?: MappingDraft | undefined; ondraft: (draft: MappingDraft) => void;
    onchange: (value: unknown) => void; range?: readonly [number, number] | undefined;
    constraint?: NumericConstraint | undefined; allowMissing?: boolean; fit: ColorFit;
  } = $props();
  const id = $props.id();
  watchNotice(() => draft?.error ? `${label}: ${draft.error}` : '');
  const own = $derived(encodingOf(value, control));
  const base = $derived(encodingOf(inherited, control));
  const mapped = $derived(own.kind === 'field' || own.kind === 'colormap' || own.kind === 'scale' ? own : null);
  const measure = $derived(mapped && measureOf(mapped.field));
  const output = $derived(measure && fields.find(field => field.id === measure.output));
  const recorded = $derived(measure && sampledName(measure.output));
  const deviating = $derived(!!recorded && measure?.basis !== 'value');
  const shown = $derived(own.kind === 'inherit' ? base : own);

  let open = $state(false);
  let popover = $state<Popover>();
  /** A formula opens on what the option draws, and takes effect only once it is changed. */
  let writing = $state(false);
  const selected = $derived<string>(writing || own.kind === 'formula' ? 'formula' : own.kind === 'inherit' ? 'default' : own.kind === 'fixed' ? 'fixed' : own.kind === 'off' ? 'off' : measure!.output);

  const basisMark = { value: '', change: ' Δ', percent: ' %' } as const;
  function fieldName(id: string) {
    const { output, basis } = measureOf(id), field = fields.find(field => field.id === output);
    return `${field ? `${output.startsWith('init.') ? 'Initial ' : ''}${field.label}` : output}${basisMark[basis]}`;
  }
  const summary = (encoding: Encoding) => encodingSummary(encoding, control, fieldName, unset);
  const reach = $derived.by(() => {
    const domain = mapped && 'domain' in mapped ? mapped.domain : undefined;
    return !Array.isArray(domain) ? '' : domain[0] === -domain[1] ? `±${domain[1]}` : `${domain[0]} to ${domain[1]}`;
  });
  const fixedColor = (encoding: Encoding) => encoding.kind === 'fixed' && control === 'color' ? String(encoding.value) : null;

  const nodeFor = (encoding: Encoding) => control === 'label' ? labelNode(encoding, constraint) : nodeOf(encoding, constraint);
  function apply(next: Encoding) {
    try { onchange(nodeFor(next)); ondraft({}); }
    catch (cause) { ondraft({ error: errorMessage(cause, 'Check this mapping.') }); }
  }
  const texts = $derived(draft?.texts ?? {});
  /** Takes what was typed, as `make` reads it, or keeps it to correct. */
  function typed(name: string, input: string, make: (value: number) => Encoding, named: string) {
    const kept = { ...texts, [name]: input }, number = Number(input);
    if (!input.trim() || !Number.isFinite(number)) { ondraft({ texts: kept, error: `Enter a number for ${named}.` }); return; }
    try { onchange(nodeFor(make(number))); ondraft({}); }
    catch (cause) { ondraft({ texts: kept, error: errorMessage(cause, 'Check this mapping.') }); }
  }
  /** Takes what was typed of one end of a pair, both ends set or, as `none`, both blank. */
  function typedEnd(names: readonly [string, string], end: 0 | 1, input: string, current: readonly [number, number] | null, make: (pair: [number, number]) => Encoding, none: Encoding, named: string) {
    const other = 1 - end as 0 | 1, otherText = texts[names[other]] ?? (current ? String(current[other]) : '');
    if (!input.trim() && !otherText.trim()) { apply(none); return; }
    if (!otherText.trim()) { ondraft({ texts: { ...texts, [names[end]]: input }, error: `Enter both ends of ${named}.` }); return; }
    typed(names[end], input, number => make(end === 0 ? [number, Number(otherText)] : [Number(otherText), number]), named);
  }
  function choose(next: string) {
    writing = next === 'formula';
    if (next === 'formula') { formula = JSON.stringify(value === undefined ? inherited ?? null : value, null, 2); ondraft({}); }
    else if (next === 'default') { apply({ kind: 'inherit' }); popover?.close(); }
    else if (next === 'off') { apply({ kind: 'off' }); popover?.close(); }
    else if (next === 'fixed') { if (own.kind !== 'fixed') apply({ kind: 'fixed', value: control === 'color' ? '#808080' : range[0] }); }
    else if (control === 'label') apply({ kind: 'field', field: next, ...own.kind === 'field' && own.maxWidth !== undefined ? { maxWidth: own.maxWidth } : {} });
    else if (control === 'color') apply({ kind: 'colormap', field: next, colormap: own.kind === 'colormap' ? own.colormap : 'viridis' });
    else apply({ kind: 'scale', field: next, scale: own.kind === 'scale' ? own.scale : [range[0], range[1]] });
  }
  /** Reads `next` of its output, on its automatic range; a deviation starts on a diverging map, so no change is its middle. */
  function setBasis(next: Basis) {
    if (!mapped || !measure) return;
    const field = fieldOf({ output: measure.output, basis: next });
    if (mapped.kind === 'colormap') {
      const { domain: _, ...rest } = mapped;
      apply({ ...rest, field, ...next !== 'value' && !diverges(mapped.colormap) ? { colormap: 'rdbu' as const } : {} });
    } else if (mapped.kind === 'scale') {
      const { domain: _, ...rest } = mapped;
      apply({ ...rest, field });
    } else apply({ ...mapped, field });
  }
  const scaled = $derived(own.kind === 'scale' ? own : null);
  const ranged = $derived(own.kind === 'colormap' || own.kind === 'scale' ? own : null);
  const domainPair = $derived(Array.isArray(ranged?.domain) ? ranged.domain as [number, number] : null);
  const domained = (domain: Domain | undefined): Encoding => {
    const { domain: _, ...rest } = ranged!;
    return { ...rest, ...domain === undefined ? {} : { domain } } as Encoding;
  };
  const scaleTo = (scale: [number, number]): Encoding => ({ kind: 'scale', field: mapped!.field, scale, ...ranged?.domain ? { domain: ranged.domain } : {} });
  const voltages = [voltagePalette(false), voltagePalette(true)];
  const isVoltage = (map: Colormap) => voltages.some(voltage => JSON.stringify(voltage) === JSON.stringify(map));
  const choices = $derived([
    { id: 'default', label: 'Default', detail: summary(base) },
    control === 'label' ? { id: 'off', label: 'Off' } : { id: 'fixed', label: 'Fixed' },
    { id: 'formula', label: 'Formula' },
  ]);
  let formula = $state('');
  function setFormula(input: string) {
    formula = input;
    let node: unknown;
    try { node = JSON.parse(input); }
    catch { ondraft({ error: 'Enter a latkit expression as JSON.' }); return; }
    apply({ kind: 'formula', node });
  }
</script>

<div class="property-row" role="group" aria-label={`${label} mapping row`}>
  <span class="property-label">{label}</span>
  <div class="property-control">
    <Popover bind:this={popover} label={`${label} mapping`} width={300} align="end" onopen={() => { open = true; writing = false; if (own.kind === 'formula') formula = JSON.stringify(value, null, 2); }} onclose={() => { open = false; }}>
      {#snippet trigger(popup)}
        <button type="button" class="c-select" aria-label={`${label} mapping`} title={own.kind === 'inherit' ? `Default: ${summary(base)}` : undefined} data-inherited={own.kind === 'inherit' || undefined}
          popovertarget={popup} aria-haspopup="dialog" aria-expanded={open} aria-controls={popup}
          aria-describedby={draft?.error ? `${id}-error` : undefined}>
          <span class="summary">
            {#if shown.kind === 'colormap'}<i class="c-ramp" style:background={rampCss(shown.colormap, fit)}></i>
            {:else if fixedColor(shown)}<i class="c-ramp" style:background={fixedColor(shown)}></i>{/if}
            <span>{own.kind === 'inherit' ? 'Default' : summary(own)}{reach ? ` ${reach}` : ''}</span>
          </span>
          <Icon name="chevron" />
        </button>
      {/snippet}
      {#snippet children()}
        {#if open}
          <FieldPicker {fields} {choices} {allowMissing} {control} {label} value={selected} onchange={choose} />
          {#if selected !== 'default' && selected !== 'off'}
            <div class="details">
              {#if selected === 'fixed'}
                {#if control === 'color'}
                  <div class="line"><label for={`${id}-fixed`}>Color</label>
                    <input id={`${id}-fixed`} type="color" aria-label={`${label} color`} value={colorHex(String(own.kind === 'fixed' ? own.value : '#808080')) ?? '#808080'} oninput={event => apply({ kind: 'fixed', value: event.currentTarget.value })} />
                  </div>
                {:else}
                  <div class="line"><label for={`${id}-fixed`}>Value</label>
                    <input id={`${id}-fixed`} aria-label={`${label} value`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" min={constraint ? 0 : undefined} step="any"
                      value={texts.fixed ?? (own.kind === 'fixed' ? String(own.value) : '')} oninput={event => typed('fixed', event.currentTarget.value, value => ({ kind: 'fixed', value }), 'the value')} />
                  </div>
                {/if}
              {:else if selected === 'formula'}
                <textarea rows="5" spellcheck="false" aria-label={`${label} formula`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} value={formula} oninput={event => setFormula(event.currentTarget.value)}></textarea>
              {:else}
                {#if recorded}
                  <div class="line"><span class="property-label">Show</span>
                    <IconToggles label={`${label} basis`} value={measure!.basis === 'value' ? null : measure!.basis} onchange={setBasis} onclear={() => setBasis('value')} options={[
                      { value: 'change', label: 'Change', icon: 'delta' },
                      { value: 'percent', label: percentable(output?.unit) ? 'Percent change' : 'An angle has no percent', icon: 'percent', disabled: !percentable(output?.unit) },
                    ]} />
                  </div>
                {/if}
                {#if own.kind === 'colormap'}
                  <div class="palettes" role="radiogroup" aria-label={`${label} palette`}>
                    {#if isVoltage(own.colormap) || mapped?.field === 'params.kv'}
                      <SwatchRadio name={id + '-palette'} label="Voltage levels" checked={isVoltage(own.colormap)} background={rampCss(voltages[0]!, fit)}
                        onchange={() => apply({ ...own, colormap: voltages[0]! } as Encoding)} />
                    {/if}
                    {#if typeof own.colormap !== 'string' && !isVoltage(own.colormap)}
                      <SwatchRadio name={id + '-palette'} label={paletteLabel(own.colormap)} checked background={rampCss(own.colormap, fit)} />
                    {/if}
                    {#each palettes(deviating) as map (map.name)}
                      <SwatchRadio name={id + '-palette'} label={map.label} checked={own.colormap === map.name} background={rampCss(map.name, fit)}
                        onchange={() => apply({ ...own, colormap: map.name } as Encoding)} />
                    {/each}
                  </div>
                {/if}
                {#if control === 'number' && mapped}
                  <div class="line"><span class="property-label">Output</span>
                    <div class="pair">
                      <input aria-label={`${label} minimum`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" min={constraint ? 0 : undefined} step="any" placeholder="Direct" value={texts.low ?? (scaled ? String(scaled.scale[0]) : '')}
                        oninput={event => typedEnd(['low', 'high'], 0, event.currentTarget.value, scaled?.scale ?? null, scaleTo, { kind: 'field', field: mapped!.field }, 'the output')} />
                      <input aria-label={`${label} maximum`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" min={constraint ? 0 : undefined} step="any" placeholder="Direct" value={texts.high ?? (scaled ? String(scaled.scale[1]) : '')}
                        oninput={event => typedEnd(['low', 'high'], 1, event.currentTarget.value, scaled?.scale ?? null, scaleTo, { kind: 'field', field: mapped!.field }, 'the output')} />
                    </div>
                  </div>
                {/if}
                {#if ranged}
                  <div class="line"><span class="property-label">Range</span>
                    {#if deviating}
                      <span class="c-field"><span class="c-field__suffix">±</span>
                        <input aria-label={`${label} band`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" min="0" step="any" placeholder={String(defaultBand({ output: recorded!, basis: measure!.basis }))} value={texts.band ?? (domainPair ? String(Math.abs(domainPair[1])) : '')}
                          oninput={event => { const input = event.currentTarget.value; if (!input.trim()) apply(domained(undefined)); else typed('band', input, band => domained(band > 0 ? [-band, band] : [band, band]), 'the band'); }} />
                      </span>
                    {:else}
                      <div class="pair">
                        <input aria-label={`${label} input minimum`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" step="any" placeholder="Auto" value={texts.min ?? (domainPair ? String(domainPair[0]) : '')}
                          oninput={event => typedEnd(['min', 'max'], 0, event.currentTarget.value, domainPair, domained, domained(undefined), 'the range')} />
                        <input aria-label={`${label} input maximum`} aria-invalid={!!draft?.error || undefined} aria-describedby={draft?.error ? `${id}-error` : undefined} type="number" step="any" placeholder="Auto" value={texts.max ?? (domainPair ? String(domainPair[1]) : '')}
                          oninput={event => typedEnd(['min', 'max'], 1, event.currentTarget.value, domainPair, domained, domained(undefined), 'the range')} />
                      </div>
                    {/if}
                  </div>
                {/if}

              {/if}
            </div>
          {/if}
        {/if}
      {/snippet}
    </Popover>
  </div>
  <span class="sr-only" id={`${id}-error`}>{draft?.error ?? ''}</span>
</div>

<style>
  .summary { display: flex; align-items: center; gap: var(--spacing-sm); min-width: 0; }
  .summary > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .summary > .c-ramp { flex: none; width: 24px; }
  [data-inherited] .summary > span { color: var(--color-text-3); }
  .details { display: grid; gap: var(--spacing-sm); padding: var(--spacing-sm); border-top: 1px solid var(--color-border); }
  .line { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: var(--spacing-sm); align-items: center; min-height: var(--control-height); }
  .line > :global(.c-toolbar__group), .line > input[type="color"] { justify-self: end; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-xs); }
  textarea { font-family: var(--font-mono); font-size: var(--control-font-size); white-space: pre; overflow: auto; }
  .palettes { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--spacing-touch-h), 1fr)); gap: var(--spacing-xs); max-height: calc(3 * var(--spacing-touch-h) + 2 * var(--spacing-xs)); overflow: auto; overscroll-behavior: contain; }
</style>
