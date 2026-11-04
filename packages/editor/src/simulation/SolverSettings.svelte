<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { CaseDocument } from '@gridkit/library';
  import { errorMessage } from '../ui/errors.js';
  import { fileName, save } from '../ui/files.js';
  import { entryOf } from '../domain/entries.js';
  import { entryChoices } from '../table/rows.js';
  import { actionTime, defaultStudy, eventFor, importStudy, studyIssues, studyTargets, withEvent, type EventType, type Study } from '@gridkit/library/gridkit';
  import { eventActions, initialization, issueLabel, solverFields } from './solver-fields.js';
  import Icon from '../ui/Icon.svelte';
  import EntryPicker from '../table/EntryPicker.svelte';
  let { document: model, value = $bindable(), initialEvent = 0, disabled = false, oninvalid, onexport }: {
    document: CaseDocument; value: Study; initialEvent?: number; disabled?: boolean; oninvalid: (invalid: boolean) => void;
    onexport?: ((study: Study) => void) | undefined;
  } = $props();
  const id = $props.id();
  const targets = $derived(studyTargets(model));
  const busChoices = $derived(entryChoices([...targets.buses.values()].map(row => entryOf(model, row))));
  const branchChoices = $derived(entryChoices([...targets.branches.values()].map(row => entryOf(model, row))));
  const issues = $derived(studyIssues(value, targets));
  const errors = $derived(new Map(issues.map(issue => [issue.path.join('.'), issue.message])));
  const invalidEvents = $derived(new Set(issues.filter(issue => issue.path[0] === 'events').map(issue => issue.path[1])));
  let ioError = $state(''), notice = $state('');
  let jsonDraft = $state<string | null>(null);
  const jsonDirty = $derived(jsonDraft !== null);
  const json = $derived(jsonDraft ?? JSON.stringify(value, null, 2));
  let jsonOpen = $state(false);
  let expanded = $state<number | null>(untrack(() => value.events?.length ? initialEvent : null));
  let picker: HTMLInputElement;
  $effect(() => oninvalid(issues.length > 0 || jsonDirty));
  const basicFields = solverFields.filter(field => !field.group);
  const integrationFields = solverFields.filter(field => field.group);
  const controlId = (key: string) => `${id}-${key}`;
  /** A blank optional setting is left to the solver; a blank required one stays blank, for validation to ask for. */
  function setNumber(key: (typeof solverFields)[number]['key'], optional: boolean, next: number | null | undefined) {
    (value as Record<string, unknown>)[key] = optional ? next ?? undefined : next;
  }
  const description = (key: string) => errors.has(key) ? `${controlId(key)}-error` : undefined;
  const eventKey = (index: number, field: string) => `events.${index}.${field}`;
  function add(type: EventType) {
    const row = (type.startsWith('fault') ? targets.buses : targets.branches).values().next().value;
    if (!row) return;
    const next = withEvent($state.snapshot(value), type, row);
    // Stable sorting puts a newly added event after existing events at the same time.
    next.events!.forEach((event, index) => { if (event.type === type && event.time === actionTime(next)) expanded = index; });
    value = next;
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
    value = next; jsonDraft = null; ioError = ''; expanded = next.events?.length ? 0 : null;
  }
  async function importFile(file: File) {
    try {
      if (file.size > 1 << 20) throw new Error('Solver settings must be smaller than 1 MiB.');
      replace(await file.text()); notice = 'Settings imported for the current case.';
    } catch (cause) { ioError = errorMessage(cause); }
  }
  export async function download() {
    if (issues.length || jsonDirty) return;
    const name = fileName(model.info.header.case_name), study = $state.snapshot(value);
    const text = JSON.stringify({system_model_file:`${name}.case.json`, output_file:`${name}.results.csv`, ...study}, null, 2);
    try { if (await save(`${name}.solver.json`, text)) onexport?.(study); }
    catch (cause) { ioError = errorMessage(cause, 'Could not download the solver settings.'); }
  }
  export function importSettings() { picker.click(); }
  export function reset() {
    value = defaultStudy(); ioError = ''; notice = 'Solver settings reset.'; jsonDraft = null; expanded = null;
  }
  export async function focusField(key: string) {
    if (key.startsWith('events.')) expanded = Number(key.split('.')[1]);
    if (key === 'json') jsonOpen = true;
    await tick();
    const target = window.document.getElementById(controlId(key.endsWith('.impedance') ? key.replace(/impedance$/, 'R') : key));
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }
  export function focusIssue() {
    return focusField(jsonDirty ? 'json' : issues[0]?.path.join('.') ?? 'tmax');
  }
</script>

{#snippet errorFor(key: string)}
  {#if errors.has(key)}<p class="field-error" id={`${controlId(key)}-error`} role="alert">{errors.get(key)}</p>{/if}
{/snippet}

{#snippet numberField(field: (typeof solverFields)[number])}
  <div class="property-row">
    <label for={controlId(field.key)}>{field.label}{#if field.unit} <span class="field-unit">({field.unit})</span>{/if}</label>
    <div class="property-control property-field">
      <input id={controlId(field.key)} aria-label={field.label} type="number" step={field.step} min={field.min}
        max={field.key === 'max_order' ? 5 : undefined} required={!field.group}
        placeholder={field.key === 'max_steps' ? 'Unbounded' : field.group ? 'Solver default' : undefined}
        bind:value={() => value[field.key], next => setNumber(field.key, !!field.group, next)}
        aria-invalid={errors.has(field.key) || undefined} aria-describedby={description(field.key)} />
      {@render errorFor(field.key)}
    </div>
  </div>
{/snippet}

<section aria-label="Solver settings">
  <input type="file" hidden accept=".json,.solver.json" aria-label="Import solver file" bind:this={picker}
    onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} />
  {#if notice}<p class="solver-notice" role="status">{notice}</p>{/if}
  {#if ioError}<p class="field-error" role="alert">{ioError}</p>{/if}
  <fieldset {disabled}>
    <legend class="sr-only">Simulation settings</legend>
    <h3>Simulation</h3>
    {#each basicFields as field (field.key)}{@render numberField(field)}{/each}

    <div class="events-heading"><h3>Events</h3><div class="actions">
      <button id={controlId('events')} type="button" class="c-icon-btn" aria-label="Add bus fault" title="Add bus fault" disabled={!targets.buses.size} onclick={() => add('fault_on')}><Icon name="fault" /></button>
      <button type="button" class="c-icon-btn" aria-label="Add line opening" title="Add line opening" disabled={!targets.branches.size} onclick={() => add('out_of_service')}><Icon name="line-open" /></button>
      <button type="button" class="c-icon-btn" aria-label="Add line closing" title="Add line closing" disabled={!targets.branches.size} onclick={() => add('in_service')}><Icon name="line-close" /></button>
      <button type="button" class="c-icon-btn" aria-label="Order events by time" title="Order events by time" disabled={!value.events?.length} onclick={() => { value.events?.sort((a,b) => a.time-b.time); expanded = null; }}><Icon name="sort" /></button>
    </div></div>
    {#if !value.events?.length}<p class="property-empty">No scheduled events.</p>{/if}
    {#each value.events ?? [] as event, index (index)}
      {@const prefix = `events.${index}.`}
      {@const target = 'bus' in event ? targets.buses.get(event.bus) : targets.branches.get(event.device)}
      {@const targetName = `${'bus' in event ? 'Bus' : 'Line'} ${'bus' in event ? event.bus : event.device}`}
      {@const eventInvalid = invalidEvents.has(index)}
      <div class="event">
        <div class="event-heading">
          <button type="button" class="event-summary" aria-expanded={expanded === index} aria-controls={expanded === index ? controlId(`event-${index}`) : undefined}
            aria-label={`Event ${index + 1}: ${eventActions[event.type].label}, ${targetName}, ${event.time} s`}
            onclick={() => { expanded = expanded === index ? null : index; }}>
            <Icon name={expanded === index ? 'chevron' : 'next'} />
            <span class="event-number">{index + 1}</span><span class="event-description">{eventActions[event.type].label}<span class="event-target-name">{targetName}</span></span>
            <span class="event-at">{event.time ?? '—'} s</span>
            {#if eventInvalid}<span class="event-warning" aria-label="Invalid event"><Icon name="warning" /></span>{/if}
          </button>
          <button type="button" class="c-icon-btn" aria-label={`Remove event ${index + 1}`} title="Remove event"
            onclick={() => { value.events?.splice(index, 1); if (expanded === index) expanded = null; else if (expanded !== null && expanded > index) expanded--; }}><Icon name="trash" /></button>
        </div>
        {#if expanded === index}
          <fieldset id={controlId(`event-${index}`)} aria-label={`Event ${index + 1}`}>
            <legend class="sr-only">Event {index + 1}</legend>
            <div class="event-command">
              <select aria-label={`Event ${index + 1} action`} value={event.type} onchange={e => changeType(index, e.currentTarget.value as EventType)}>
                {#each Object.entries(eventActions) as [type, action] (type)}<option value={type}>{action.label}</option>{/each}
              </select>
              <div class="property-field">
                <label class="event-time"><span class="sr-only">Event {index + 1} time (s)</span><input id={controlId(prefix + 'time')} type="number" step="any" min="0" max={value.tmax} bind:value={event.time}
                  aria-invalid={errors.has(prefix + 'time') || undefined} aria-describedby={description(prefix + 'time')} /><span class="field-unit">s</span></label>
              </div>
            </div>
            {@render errorFor(prefix + 'time')}
            <div class="property-row event-target"><span class="property-label">{'bus' in event ? 'Bus' : 'Line'}</span><div class="property-control property-field">
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
            </div></div>
            {#if event.type === 'fault_on'}
              <div class="impedance">
                {#each ['R', 'X'] as field (field)}
                  {@const key = eventKey(index, field)}
                  <div class="property-field">
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
        {/if}
      </div>
    {/each}

    <section class="solver-section" aria-label="Integration">
      <h3>Integration</h3>
      <p class="solver-notice">Blank values use solver defaults. Output interval controls recording; integration step controls solving.</p>
      {#each integrationFields as field (field.key)}{@render numberField(field)}{/each}
      <div class="property-row initialization"><label for={controlId(initialization.key)}>{initialization.label}</label><div class="property-control property-field">
        <select id={controlId(initialization.key)} bind:value={value.consistent_ic_type}>
          <option value={undefined}>Solver default</option><option value="ya_ydp">Algebraic states and derivatives</option><option value="y">States</option>
        </select>
      </div></div>
    </section>
    <details class="solver-details c-details" bind:open={jsonOpen}>
      <summary><Icon name="chevron" />JSON</summary>
      <label class="sr-only" for={controlId('json')}>Solver JSON</label>
      <textarea class="solver-json" id={controlId('json')} rows="12" maxlength={1 << 20} spellcheck="false" value={json}
        oninput={event => { jsonDraft = event.currentTarget.value; }}></textarea>
      <div class="actions json-actions">
        {#if jsonDirty}<span class="solver-notice">Apply or discard JSON edits.</span>{/if}
        <button type="button" class="c-icon-btn" aria-label="Discard JSON changes" title="Discard JSON changes" disabled={!jsonDirty}
          onclick={() => { jsonDraft = null; ioError = ''; }}><Icon name="undo" /></button>
        <button type="button" class="c-icon-btn" aria-label="Apply JSON changes" title="Apply JSON changes" disabled={!jsonDirty}
          onclick={() => { try { replace(json); } catch (cause) { ioError = errorMessage(cause); } }}><Icon name="check" /></button>
      </div>
    </details>
  </fieldset>
</section>

<style>
  fieldset { min-width: 0; gap: 0; }
  .actions, .events-heading, .event-time, .event-heading { display: flex; align-items: center; gap: var(--spacing-xs); }
  .events-heading { justify-content: space-between; margin-top: 16px; }
  .events-heading h3 { margin: 0; }
  .event { padding: 4px 0; border-bottom: 1px solid var(--color-divider); }
  .event fieldset { padding-block: 4px 8px; }
  .event-summary { display: flex; align-items: center; gap: var(--spacing-sm); flex: 1; min-width: 0; text-align: left; padding: 4px 0; }
  .event-summary :global(svg) { width: 14px; height: 14px; flex: none; }
  .event-description { flex: 1; min-width: 0; }
  .event-target-name { display: block; color: var(--color-text-2); font: var(--type-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-number, .event-at { color: var(--color-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .event-warning { display: flex; color: var(--color-error); }
  .event-command { display: grid; grid-template-columns: minmax(0, 1fr) 7rem; gap: var(--spacing-sm); align-items: center; }
  .event-time input { min-width: 0; width: 100%; }
  .event-target { border-top: 0; }
  .impedance { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md); }
  .impedance input { min-width: 0; width: 100%; }
  .solver-notice { margin-block: 8px; color: var(--color-text-2); font: var(--type-caption); }
  .solver-details, .solver-section { margin-top: var(--spacing-lg); }
  .solver-json { width: 100%; font-family: monospace; margin-top: 8px; }
  .json-actions { justify-content: flex-end; flex-wrap: wrap; }
  .json-actions .solver-notice { margin-right: auto; }
  .field-error { white-space: pre-wrap; }
  @container property-sheet (max-width: 420px) {
    .property-row { grid-template-columns: minmax(0, 1fr); gap: var(--spacing-xs); padding-block: var(--spacing-sm); }
  }
</style>
