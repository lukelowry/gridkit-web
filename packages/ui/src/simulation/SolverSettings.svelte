<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { CaseDocument } from '@gridkit/library';
  import { errorMessage } from '../ui/errors.js';
  import { notify, watchNotice } from '../ui/toasts.svelte.js';
  import { fileName, save } from '../ui/files.js';
  import { entryOf } from '../domain/entries.js';
  import { entryChoices } from '../table/rows.js';
  import { actionTime, defaultStudy, eventFor, importStudy, studyIssues, studyTargets, withEvent, type EventType, type Study } from '@gridkit/library/gridkit';
  import { eventActions, integrationDefaults, initialization, issueLabel, solverFields } from './solver-fields.js';
  import Icon from '../ui/Icon.svelte';
  import EntryPicker from '../table/EntryPicker.svelte';
  let { document: model, value = $bindable(), disabled = false, oninvalid }: {
    document: CaseDocument; value: Study; disabled?: boolean; oninvalid: (invalid: boolean) => void;
  } = $props();
  const id = $props.id();
  const defaults = $derived(integrationDefaults(value));
  const targets = $derived(studyTargets(model));
  const busChoices = $derived(entryChoices([...targets.buses.values()].map(row => entryOf(model, row))));
  const branchChoices = $derived(entryChoices([...targets.branches.values()].map(row => entryOf(model, row))));
  const issues = $derived(studyIssues(value, targets));
  const errors = $derived(new Map(issues.map(issue => [issue.path.join('.'), issue.message])));
  let jsonText = $state<string | null>(null);
  let jsonError = $state('');
  let jsonValue = JSON.stringify(untrack(() => value));
  const json = $derived(jsonText ?? JSON.stringify(value, null, 2));
  let jsonOpen = $state(false);
  let picker: HTMLInputElement;
  $effect(() => oninvalid(issues.length > 0 || !!jsonError));
  watchNotice(() => jsonError || issues.map(issueLabel).join('\n'), () => ({ action: { label: 'Show field', run: () => { void focusIssue(); } } }));
  $effect(() => {
    const next = JSON.stringify(value);
    untrack(() => { if (next !== jsonValue) { jsonText = null; jsonError = ''; jsonValue = next; } });
  });
  const basicFields = solverFields.filter(field => !field.group);
  const integrationFields = solverFields.filter(field => field.group);
  const controlId = (key: string) => `${id}-${key}`;
  /** A blank optional setting is left to the solver; a blank required one stays blank, for validation to ask for. */
  function setNumber(key: (typeof solverFields)[number]['key'], optional: boolean, next: number | null | undefined) {
    (value as Record<string, unknown>)[key] = optional ? next ?? undefined : next;
  }
  const description = (key: string) => errors.has(key) ? `${controlId(key)}-error` : undefined;
  const eventKey = (index: number, field: string) => `events.${index}.${field}`;
  async function add(type: EventType) {
    const row = (type.startsWith('fault') ? targets.buses : targets.branches).values().next().value;
    if (!row) return;
    const time = actionTime(value), next = withEvent($state.snapshot(value), type, row);
    const index = next.events!.findLastIndex(event => event.type === type && event.time === time);
    value = next;
    await focusField(eventKey(index, 'time'));
  }
  async function remove(index: number) {
    value.events?.splice(index, 1);
    const remaining = value.events?.length ?? 0;
    await focusField(remaining ? eventKey(Math.min(index, remaining - 1), 'time') : 'events');
  }
  function changeType(index: number, type: EventType) {
    const previous = value.events![index]!;
    const row = type.startsWith('fault')
      ? ('bus' in previous ? targets.buses.get(previous.bus) : undefined) ?? targets.buses.values().next().value
      : ('device' in previous ? targets.branches.get(previous.device) : undefined) ?? targets.branches.values().next().value;
    value.events![index] = eventFor(type, previous.time, row);
  }
  function replace(text: string) {
    const next = importStudy(text), problems = studyIssues(next, targets);
    if (problems.length) throw new Error(problems.map(issueLabel).join('\n'));
    value = next; jsonText = null; jsonError = ''; jsonValue = JSON.stringify(next);
  }
  async function importFile(file: File) {
    try {
      if (file.size > 1 << 20) throw new Error('Solver settings must be smaller than 1 MiB.');
      replace(await file.text()); notify('Solver settings imported.', { key: 'solver-settings', tone: 'info' });
    } catch (cause) { notify(errorMessage(cause), { key: 'solver-settings' }); }
  }
  export async function download() {
    if (issues.length || jsonError) return;
    const name = fileName(model.info.header.case_name), study = $state.snapshot(value);
    const text = JSON.stringify({system_model_file:`${name}.case.json`, output_file:`${name}.results.csv`, ...study}, null, 2);
    try { await save(`${name}.solver.json`, text); }
    catch (cause) { notify(errorMessage(cause, 'Could not download the solver settings.'), { key: 'solver-settings' }); }
  }
  export function importSettings() { picker.click(); }
  export function reset() {
    value = defaultStudy(); jsonText = null; jsonError = '';
    notify('Solver settings reset.', { key: 'solver-settings', tone: 'info' });
  }
  async function focusField(key: string) {
    if (key === 'json') jsonOpen = true;
    await tick();
    const target = window.document.getElementById(controlId(key.endsWith('.impedance') ? key.replace(/impedance$/, 'R') : key));
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }
  export function focusIssue() {
    return focusField(jsonError ? 'json' : issues[0]?.path.join('.') ?? 'tmax');
  }
  function readJson(text: string) {
    jsonText = text;
    try { const next = importStudy(text); value = next; jsonValue = JSON.stringify(next); jsonError = ''; }
    catch (cause) { jsonError = cause instanceof SyntaxError ? 'Enter valid JSON. Check quotes, commas, and braces.' : errorMessage(cause); }
  }
</script>

{#snippet errorFor(key: string)}
  <span class="sr-only" id={`${controlId(key)}-error`}>{errors.get(key) ?? ''}</span>
{/snippet}

{#snippet numberField(field: (typeof solverFields)[number])}
  <div class="property-row">
    <label for={controlId(field.key)}>{field.label}{#if field.unit} <span class="field-unit" id={`${controlId(field.key)}-unit`}>({field.unit})</span>{/if}</label>
    <div class="property-control property-field">
      <input id={controlId(field.key)} aria-label={field.label} type="number" step={field.step} min={field.min}
        max={field.key === 'max_order' ? 5 : undefined} required={!field.group}
        placeholder={field.key in defaults ? String(defaults[field.key as keyof typeof defaults]) : undefined}
        bind:value={() => value[field.key], next => setNumber(field.key, !!field.group, next)}
        aria-invalid={errors.has(field.key) || undefined}
        aria-describedby={[field.unit ? `${controlId(field.key)}-unit` : undefined, description(field.key)].filter(Boolean).join(' ') || undefined} />
      {@render errorFor(field.key)}
    </div>
  </div>
{/snippet}

<section class="solver-settings" aria-label="Solver settings">
  <input type="file" hidden accept=".json,.solver.json" aria-label="Import solver file" bind:this={picker}
    onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} />
  <fieldset class="solver-columns" {disabled}>
    <legend class="sr-only">Simulation settings</legend>
    <div class="solver-fields">
    <h3>Simulation</h3>
    {#each basicFields as field (field.key)}{@render numberField(field)}{/each}

    <div class="events-heading"><h3>Events</h3><div class="actions">
      <button id={controlId('events')} type="button" class="c-icon-btn" aria-label="Add bus fault" title="Add bus fault" disabled={!targets.buses.size} onclick={() => add('fault_on')}><Icon name="fault" /></button>
      <button type="button" class="c-icon-btn" aria-label="Add line opening" title="Add line opening" disabled={!targets.branches.size} onclick={() => add('out_of_service')}><Icon name="line-open" /></button>
      <button type="button" class="c-icon-btn" aria-label="Add line closing" title="Add line closing" disabled={!targets.branches.size} onclick={() => add('in_service')}><Icon name="line-close" /></button>
      <button type="button" class="c-icon-btn" aria-label="Order events by time" title="Order events by time" disabled={!value.events?.length} onclick={() => { value.events?.sort((a,b) => a.time-b.time); }}><Icon name="sort" /></button>
    </div></div>
    {#if !value.events?.length}<p class="property-empty">No scheduled events.</p>{/if}
    {#each value.events ?? [] as event, index (index)}
      {@const prefix = `events.${index}.`}
      {@const target = 'bus' in event ? targets.buses.get(event.bus) : targets.branches.get(event.device)}
      <fieldset class="event" aria-label={`Event ${index + 1}`}>
        <legend class="sr-only">Event {index + 1}</legend>
        <div class="event-row">
          <div class="event-field event-time">
            <label for={controlId(prefix + 'time')}>Time <span class="field-unit">(s)</span></label>
            <input id={controlId(prefix + 'time')} aria-label={`Event ${index + 1} time (s)`} type="number" step="any" min="0" max={value.tmax} bind:value={event.time}
              aria-invalid={errors.has(prefix + 'time') || undefined} aria-describedby={description(prefix + 'time')} />
            {@render errorFor(prefix + 'time')}
          </div>
          <div class="event-field event-action">
            <label for={controlId(prefix + 'action')}>Action</label>
            <select id={controlId(prefix + 'action')} aria-label={`Event ${index + 1} action`} value={event.type} onchange={e => changeType(index, e.currentTarget.value as EventType)}>
              {#each Object.entries(eventActions) as [type, action] (type)}<option value={type}>{action.label}</option>{/each}
            </select>
          </div>
          <div class="event-field event-target">
            <label for={controlId(prefix + ('bus' in event ? 'bus' : 'device'))}>{'bus' in event ? 'Bus' : 'Line'}</label>
            {#if 'bus' in event}
              <EntryPicker choices={busChoices} id={controlId(prefix + 'bus')} label={`Event ${index + 1} bus`} collectionLabel="Buses" unresolved={String(event.bus)}
                bind:value={() => target?.ref.id ?? '', key => { const entry = busChoices.byId.get(key); if (entry) event.bus = Number(model.get(entry)!.value.number); }}
                invalid={errors.has(prefix + 'bus')} describedby={description(prefix + 'bus')} />
              {@render errorFor(prefix + 'bus')}
            {:else}
              <EntryPicker choices={branchChoices} id={controlId(prefix + 'device')} label={`Event ${index + 1} line`} collectionLabel="Lines" unresolved={event.device}
                bind:value={() => target?.ref.id ?? '', key => { const entry = branchChoices.byId.get(key); if (entry) event.device = String(model.get(entry)!.value.id); }}
                invalid={errors.has(prefix + 'device')} describedby={description(prefix + 'device')} />
              {@render errorFor(prefix + 'device')}
            {/if}
          </div>
          <button type="button" class="c-icon-btn event-remove" aria-label={`Remove event ${index + 1}`} title="Remove event"
            onclick={() => remove(index)}><Icon name="close" /></button>
        </div>
        {#if event.type === 'fault_on'}
          <div class="impedance">
            {#each ['R', 'X'] as field (field)}
              {@const key = eventKey(index, field)}
              <div class="event-field">
                <label for={controlId(key)}>{field} <span class="field-unit">(p.u.)</span></label>
                <input id={controlId(key)} aria-label={`Event ${index + 1} ${field === 'R' ? 'resistance' : 'reactance'} (p.u.)`} type="number" step="any"
                  bind:value={event[field as 'R' | 'X']} aria-invalid={errors.has(key) || errors.has(prefix + 'impedance') || undefined}
                  aria-describedby={[description(key), description(prefix + 'impedance')].filter(Boolean).join(' ') || undefined} />
                {@render errorFor(key)}
              </div>
            {/each}
          </div>
          {@render errorFor(prefix + 'impedance')}
        {/if}
      </fieldset>
    {/each}

    <section class="solver-section" aria-label="Integration">
      <h3>Integration</h3>
      {#each integrationFields as field (field.key)}{@render numberField(field)}{/each}
      <div class="property-row initialization"><label for={controlId(initialization.key)}>{initialization.label}</label><div class="property-control property-field">
        <select id={controlId(initialization.key)} bind:value={() => value.consistent_ic_type ?? 'ya_ydp', next => { value.consistent_ic_type = next; }}>
          <option value="ya_ydp">ya_ydp</option><option value="y">y</option>
        </select>
      </div></div>
    </section>
    </div>
    <section class="solver-json-panel" aria-label="Solver JSON panel">
      <h3 class="json-title">JSON</h3>
      <button type="button" class="json-toggle" aria-expanded={jsonOpen} aria-controls={controlId('json-content')} onclick={() => { jsonOpen = !jsonOpen; }}><Icon name={jsonOpen ? 'chevron' : 'next'} />JSON</button>
      <div class="json-content" class:open={jsonOpen} id={controlId('json-content')}>
      <label class="sr-only" for={controlId('json')}>Solver JSON</label>
      <textarea class="solver-json" id={controlId('json')} rows="12" maxlength={1 << 20} spellcheck="false" value={json}
        aria-invalid={!!jsonError || undefined} aria-describedby={jsonError ? controlId('json-error') : undefined}
        oninput={event => readJson(event.currentTarget.value)}></textarea>
      <span class="sr-only" id={controlId('json-error')}>{jsonError}</span>
      </div>
    </section>
  </fieldset>
</section>

<style>
  fieldset { min-width: 0; gap: 0; }
  .actions, .events-heading { display: flex; align-items: center; gap: var(--spacing-xs); }
  .events-heading { justify-content: space-between; flex-wrap: wrap; margin-top: 8px; }
  .events-heading h3 { margin: 0; white-space: nowrap; }
  .event { padding: 8px 0 12px; border-bottom: 1px solid var(--color-divider); container: event / inline-size; }
  .event-row {
    display: grid;
    grid-template-columns: 6rem 9rem minmax(0, 14rem) var(--control-height);
    grid-auto-rows: auto;
    gap: var(--spacing-xs) var(--spacing-sm);
    align-items: start;
  }
  .event-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--spacing-xs);
    min-width: 0;
  }
  .event-field > label { font: var(--type-caption); color: var(--color-text-2); }
  .event-field input, .event-field select { width: 100%; min-width: 0; }
  .event-row > .event-field { grid-row: 1 / span 2; grid-template-rows: subgrid; align-self: stretch; }
  .event-row > .event-time { grid-column: 1; }
  .event-row > .event-action { grid-column: 2; }
  .event-row > .event-target { grid-column: 3; }
  .event-row > .event-field > label { grid-row: 1; }
  .event-row > .event-field > input,
  .event-row > .event-field > select,
  .event-row > .event-field > :global(.popover-anchor) { grid-row: 2; }
  .event-remove { grid-column: 4; grid-row: 2; align-self: start; margin: 0; }
  .impedance { display: grid; grid-template-columns: repeat(2, 6rem); gap: 8px; margin-top: 8px; }
  @container event (max-width: 520px) {
    .event-row { grid-template-columns: 6rem minmax(0, 1fr) var(--control-height); }
    .event-row > .event-target { grid-column: 1 / 3; grid-row: 3 / span 2; }
    .event-remove { grid-column: 3; }
  }
  @container event (max-width: 15rem) {
    .event-row { grid-template-columns: minmax(0, 1fr) var(--control-height); }
    .event-row > .event-time { max-width: 7rem; }
    .event-row > .event-action { grid-column: 1 / -1; grid-row: 3 / span 2; }
    .event-row > .event-target { grid-column: 1 / -1; grid-row: 5 / span 2; }
    .event-remove { grid-column: 2; }
    .impedance { grid-template-columns: repeat(2, minmax(0, 6rem)); }
  }
  .property-empty { margin: 4px 0; }
  .solver-section { margin-top: 12px; }
  .solver-json { width: 100%; font-family: var(--font-mono); margin-top: 8px; min-height: 18rem; }
  .initialization select { text-overflow: ellipsis; }
  .solver-settings { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .solver-columns { display: block; flex: 1; }
  .solver-fields { min-width: 0; }
  .json-title { display: none; }
  .json-content { display: none; }
  .json-content.open { display: block; }
  .json-toggle { display: flex; align-items: center; gap: 8px; padding-inline: 0; }
  .solver-json-panel { margin-top: 12px; min-width: 0; }
  @container property-sheet (min-width: 832px) {
    .solver-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: stretch; }
    .solver-json-panel { display: flex; flex-direction: column; margin-top: 0; }
    .json-title { display: block; }
    .json-toggle { display: none; }
    .json-content, .json-content.open { display: flex; flex-direction: column; flex: 1; }
    .solver-json { flex: 1; resize: vertical; }
  }
</style>
