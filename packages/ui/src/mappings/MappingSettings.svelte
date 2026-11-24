<script lang="ts">
  import { readMark, type MappingOptions, type MarkDefinition } from '../domain/views.js';
  import type { MappingTransaction } from '../domain/views.js';
  import { elementCatalog, record, type CaseDocument, type ElementTarget, type SavedViews } from '@gridkit/library';
  import { categoryExamples, fieldMinimum, numericConstraint, numericIssue } from './numeric.js';
  import { watchNotice } from '../ui/toasts.svelte.js';
  import { errorMessage } from '../ui/errors.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { resolveNetwork, networkTheme, paletteTokens, placementOf, effectiveOptions, drawingOf, positionOf, networkSpace, earthSpace } from './defaults.js';
  import type { OptionControl } from './encoding.js';
  import type { ColorFit } from '../ui/ramps.js';
  import MarkDetails from './MarkDetails.svelte';
  import MappingRow, { type MappingDraft } from './MappingRow.svelte';
  import IconToggles from '../ui/IconToggles.svelte';
  import Icon from '../ui/Icon.svelte';
  import type { IconName } from '../ui/icons.js';
  import { themeColors } from '../ui/color.js';
  import { simulationFields } from '../simulation/sampled.js';
  import type { Measure } from '../domain/measure.js';
  let { document, preferences, value, geographic = false, simulation = false, measure, band, scope = 'view', onchange, oninvalid = () => {} }: {
    document: CaseDocument; preferences: PreferencesState; value: SavedViews;
    geographic?: boolean; simulation?: boolean; measure?: Measure | undefined; band?: number | null | undefined; scope?: 'view' | 'browser';
    onchange: (operation: (tx: MappingTransaction) => void) => void; oninvalid?: (invalid: boolean) => void;
  } = $props();
  let drafts = $state<Record<string, MappingDraft>>({});
  let error = $state('');
  watchNotice(() => error);
  // Sections stay as the user left them while their mappings change; Buses opens first.
  let opened = $state<Record<string, boolean>>({ buses: true });
  const sampled = $derived(simulationFields(document));
  const source = $derived({ targets: document.targets, geographic, simulation, measure, band, fields: (target: ElementTarget) => sampled(target),
    drawing: drawingOf(document, earthSpace(networkSpace(geographic, scope === 'view' ? preferences.mappings : {}, value)) ? 'geographic' : 'network') });
  const settings = $derived(preferences.value);
  const theme = $derived(networkTheme(settings, undefined, preferences.theme));
  const inherited = $derived(resolveNetwork({ source, theme, preferences: settings, userDefaults: scope === 'view' ? preferences.mappings : {} }));
  const resolved = $derived(resolveNetwork({ source, theme, preferences: settings, userDefaults: scope === 'view' ? preferences.mappings : {}, caseOverrides: value }));
  const savedMarks = $derived(Array.isArray(record(value.network)?.marks) ? (record(value.network)!.marks as unknown[]).map(readMark).filter(mark => mark !== null) : []);
  const marks = $derived([...resolved.marks].sort((a, b) => Number(b.id === 'buses') - Number(a.id === 'buses')));
  const ownOptions = (mark: MarkDefinition) => savedMarks.find(item => item.id === mark.id)?.options as Record<string, unknown> | undefined ?? {};
  const baseOptions = (mark: MarkDefinition) => effectiveOptions(inherited.marks.find(item => item.id === mark.id), inherited.theme);
  const markLabel = (mark: MarkDefinition) => ({ buses: 'Buses', branches: 'Branches' })[mark.id]
    ?? elementCatalog.get(mark.target.class ?? '')?.label ?? mark.target.class ?? mark.id;
  // Previews draw what the view draws: its colormaps fitted to its background, at its contrast.
  const fit = $derived.by<ColorFit>(() => {
    void preferences.theme;
    return { grounds: [themeColors(paletteTokens).background], floor: preferences.contrast === 'high' ? 7 : 4.5 };
  });
  /** An option's row; `unset` names what its default is when the mark sets nothing, latkit's own. */
  type Row = { id: string; label: string; option: keyof MappingOptions; control: OptionControl; range?: readonly [number, number]; unset?: string };
  // Elevation uses plane units or degrees of arc, up to the drawing's height.
  const height = $derived(source.drawing?.height ?? 0);
  const rows = (mark: MarkDefinition): Row[] => [
    { id: 'color', label: 'Color', option: 'color', control: 'color' },
    ...(mark.kind === 'vertices' ? [
      { id: 'bearing', label: 'Bearing', option: 'bearing', control: 'number' as const, range: [0, 360] as const },
      { id: 'radius', label: 'Radius', option: 'radius', control: 'number' as const },
      { id: 'elevation', label: 'Elevation', option: 'elevation', control: 'number' as const, range: [0, height || 40] as const },
    ] : [
      { id: 'width', label: 'Width', option: 'width', control: 'number' as const },
      // Comets along each edge, in CSS pixels a second, toward its to end or back: a branch's real power into its to bus moves them
      // the way power flows.
      { id: 'flow', label: 'Flow', option: 'flow', control: 'speed' as const, range: [-60, 60] as const, unset: 'Off' },
    ]) as Row[],
    { id: 'label', label: 'Label', option: 'label', control: 'label' },
  ];
  const rowValue = (options: Record<string, unknown>, row: Row) => options[row.option];
  const draftKey = (mark: MarkDefinition, id: string) => JSON.stringify([scope, mark.id, id]);
  function setDraft(key: string, draft: MappingDraft) {
    if (draft.error || draft.texts) drafts[key] = draft;
    else delete drafts[key];
    oninvalid(Object.values(drafts).some(draft => !!draft.error));
  }
  function setOption<P extends keyof MappingOptions>(mark: MarkDefinition, key: P, value: Required<MappingOptions>[P] | undefined) {
    const target = { mark: mark.id };
    onchange(tx => value === undefined ? tx.reset(target, key) : tx.map(target, key, value));
  }
  function edit(mark: MarkDefinition) {
    const set = <P extends keyof MappingOptions>(key: P, next: Required<MappingOptions>[P] | undefined) => setOption(mark, key, next);
    return { ...mark, options: { ...mark.options, ...ownOptions(mark) }, set };
  }
  function map(mark: MarkDefinition, row: Row, next: unknown) {
    const issue = numericIssue(next, numericConstraint(row.option), field => fieldMinimum(document, mark.target, field));
    if (issue) throw new Error(issue);
    // The formula editor accepts native option JSON at this boundary.
    setOption(mark, row.option, next as MappingOptions[typeof row.option]);
  }
  /** An option of a few choices, drawn as the choices, or that is simply on or off. */
  type Choice = { option: 'marker' | 'visible' | 'position' | 'route' | 'dash'; label: string; icons?: readonly { value: string; label: string; icon: IconName }[] };
  const choices = (mark: MarkDefinition): Choice[] => [
    ...(mark.kind === 'vertices' ? [{ option: 'marker' as const, label: 'Shape', icons: [
      { value: 'ellipse', label: 'Circle', icon: 'shape-ellipse' as const }, { value: 'rectangle', label: 'Rectangle', icon: 'shape-rectangle' as const },
      { value: 'rounded', label: 'Rounded rectangle', icon: 'shape-rounded' as const }, { value: 'diamond', label: 'Diamond', icon: 'shape-diamond' as const },
      { value: 'block', label: 'Block', icon: 'shape-block' as const }] }] : []),
    { option: 'visible', label: 'Visible' },
    ...(mark.kind === 'vertices' ? [{ option: 'position' as const, label: 'Position', icons: [
      { value: 'network', label: 'Network layout', icon: 'network' as const }, { value: 'geographic', label: 'Geographic', icon: 'projection-globe' as const }] }] : [
      { option: 'route' as const, label: 'Routing', icons: [{ value: 'straight', label: 'Straight', icon: 'route-straight' as const },
        { value: 'geodesic', label: 'Geodesic', icon: 'route-geodesic' as const }] },
      { option: 'dash' as const, label: 'Dashed' },
    ]),
  ];
  const choiceValue = (row: Choice, value: unknown) => row.option === 'position' ? placementOf(value) : typeof value === 'string' ? value : null;
  function choose(mark: MarkDefinition, row: Choice, next: string | boolean) {
    const target = { mark: mark.id };
    try {
      onchange(tx => {
        if (row.option === 'position') {
          tx.map(target, 'position', positionOf(next === 'geographic' ? 'geographic' : 'network'));
          tx.view({ space: next === 'geographic' ? { earth: { projection: 'mercator' } } : 'plane' });
        } else tx.map(target, row.option, next as Exclude<MappingOptions[typeof row.option], undefined>);
      });
      error = '';
    } catch (cause) { error = errorMessage(cause, 'Could not change mapping.'); }
  }
  /** Returns a mark to what it inherits, as Reset section does a preference page. */
  function resetMark(mark: MarkDefinition, keys: readonly string[]) {
    const target = { mark: mark.id };
    for (const row of rows(mark)) setDraft(draftKey(mark, row.id), {});
    onchange(tx => {
      for (const key of keys) tx.reset(target, key as keyof MappingOptions);
      if (keys.includes('position')) tx.view({ space: inherited.space });
    });
  }
</script>

{#if !earthSpace(resolved.space)}
  <label class="property-row">Drawing Y axis
    <select value={typeof resolved.space === 'object' && 'plane' in resolved.space ? resolved.space.plane.y ?? 'up' : 'up'}
      onchange={({ currentTarget }) => onchange(tx => tx.view({ space: { plane: {
        ...typeof resolved.space === 'object' && 'plane' in resolved.space && resolved.space.plane, y: currentTarget.value === 'down' ? 'down' : 'up',
      } } }))}>
      <option value="up">Up</option><option value="down">Down</option>
    </select>
  </label>
{/if}
{#if !marks.length}
  <p class="property-empty">No mappings in this view.</p>
  {#if value.network !== undefined}<button type="button" onclick={() => { if (window.confirm('Reset all mappings in this view?')) { onchange(tx => tx.resetView()); } }}>Reset view mappings</button>{/if}
{/if}
{#each marks as mark (mark.id)}
  {@const own = ownOptions(mark)}
  {@const base = baseOptions(mark)}
  {@const fields = document.fields(mark.target)}
  {@const controls = rows(mark)}
  {@const options = choices(mark)}
  {@const detailKeys = ['meet', 'markers', 'blend']}
  {@const other = Object.keys(own).filter(key => !detailKeys.includes(key) && !controls.some(row => row.option === key) && !options.some(row => row.option === key))}
  {@const resettable = Object.keys(own).filter(key => detailKeys.includes(key) || controls.some(row => row.option === key) || options.some(row => row.option === key))}
  <details class="mapping-section c-details" aria-label={markLabel(mark)} bind:open={() => opened[mark.id] ?? false, open => { opened[mark.id] = open; }}>
    <summary><Icon name="chevron" />{markLabel(mark)}</summary>
    <button type="button" class="reset-mark" aria-label={`Reset ${markLabel(mark)} mappings`} disabled={!resettable.length} onclick={() => resetMark(mark, resettable)}>Reset</button>
    {#each controls as row (row.id)}
      {@const key = draftKey(mark, row.id)}
      {#key key}
        <MappingRow label={row.label} control={row.control} value={rowValue(own, row)} inherited={rowValue(base, row)} unset={row.unset} fields={sampled(mark.target)} range={row.range} constraint={numericConstraint(row.option)} allowMissing={scope === 'browser'}
          {fit} samples={name => categoryExamples(document, mark.target, name)} draft={drafts[key]} ondraft={draft => setDraft(key, draft)} onchange={next => map(mark, row, next)} />
      {/key}
    {/each}
    {#each options as row (row.option)}
      {@const current = own[row.option] === undefined ? base[row.option] : own[row.option]}
      <div class="property-row">
        <span class="property-label">{row.label}</span>
        <div class="property-control">
          {#if row.icons}
            <IconToggles label={row.label} value={choiceValue(row, current)} onchange={value => choose(mark, row, value)}
              options={row.icons.map(icon => ({ ...icon, disabled: row.option === 'position' && icon.value === 'geographic' && scope === 'view' && !geographic }))} />
          {:else}
            <input type="checkbox" aria-label={row.label} checked={current === true} onchange={event => choose(mark, row, event.currentTarget.checked)} />
          {/if}
        </div>
      </div>
    {/each}
    <MarkDetails editor={edit(mark)}
      labelSize={resolved.theme.text?.size ?? 12} {fields} onlabel={label => setOption(mark, 'label', label)} onissue={(id, message) => setDraft(id, message ? { error: message } : {})} />
    {#if other.length}<p class="property-empty">Other saved mappings are preserved: {other.join(', ')}.</p>{/if}
  </details>
{/each}

<style>
  /* Sections as Solver's are, each with its reset where a preference page has Reset section. */
  .mapping-section { position: relative; margin-top: var(--spacing-sm); }
  .reset-mark { position: absolute; top: 0; right: 0; white-space: nowrap; }
  .property-control :global(.c-toolbar__group) { justify-content: flex-end; }
  @media (pointer: coarse) { .reset-mark { min-height: 44px; } }
</style>
