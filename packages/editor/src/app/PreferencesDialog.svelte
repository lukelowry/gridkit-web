<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { applies, categories, preferenceFields, preferenceKeys } from '../preferences/definitions.js';
  import { createPreferences, type PreferencesState } from '../preferences/state.svelte.js';
  import { equal, type CaseDocument, type SavedViews } from '@gridkit/library';
  import { watchNotice } from '../ui/toasts.svelte.js';
  import { errorMessage } from '../ui/errors.js';
  import Dialog from '../ui/Dialog.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import PreferenceControl from '../preferences/PreferenceControl.svelte';
  import Icon from '../ui/Icon.svelte';
  import type { Measure } from '../domain/measure.js';
  import { defaultMarks, mappingDraft } from '../domain/views.js';
  import MappingEditor from '../mappings/MappingEditor.svelte';

  let { preferences, document, mappings, onmappings, geographic, caseOpen, simulation = false, measure, band, initialPage = 'appearance', onpending, onclose }: {
    preferences: PreferencesState; document: CaseDocument; mappings: SavedViews; onmappings: (value: SavedViews) => void; geographic: boolean; caseOpen: boolean; simulation?: boolean; measure?: Measure | undefined; band?: number | null | undefined;
    initialPage?: string;
    onpending: (pending: boolean) => void; onclose: () => void;
  } = $props();
  const baseline = untrack(() => preferences.serialize());
  const draft = untrack(() => createPreferences(baseline));
  const preferencesChanged = $derived(draft.serialize() !== baseline);
  const initialMappings = untrack(() => mappings);
  let viewMappings = $state.raw(initialMappings);
  const mappingsChanged = $derived(!equal(viewMappings, initialMappings));
  const dirty = $derived(preferencesChanged || mappingsChanged);
  let mappingInvalid = $state(false), invalidFields = $state<Record<string, boolean>>({});
  let controlRevision = $state<Record<string, number>>({});
  const invalid = $derived(mappingInvalid || Object.values(invalidFields).some(Boolean));
  let mappingScope = $state<'view' | 'browser'>(untrack(() => caseOpen ? 'view' : 'browser'));
  let error = $state('');
  watchNotice(() => error || preferences.issue);
  const mappingPages = [
    { id: 'network-mappings', label: 'Network', icon: 'network' },
  ] as const;
  $effect(() => onpending(dirty || invalid));
  onDestroy(() => onpending(false));
  function close() { if ((!dirty && !invalid) || window.confirm('Discard settings changes?')) onclose(); }
  function apply() {
    error = '';
    try {
      if (invalid) {
        error = 'Resolve the settings errors before continuing.'; return;
      }
      if (preferencesChanged) preferences.apply(draft.serialize());
      if (mappingsChanged) onmappings(viewMappings);
      if (!preferencesChanged || !preferences.issue) {
        onpending(false); onclose();
      }
    } catch (cause) { error = errorMessage(cause, 'Could not apply changes.'); }
  }
  const id = $props.id();
  let query = $state('');
  let active = $state(untrack(() => initialPage));
  let search = $state<SearchField>();
  let notice = $state('');
  const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const showingMappings = $derived(mappingPages.some(page => page.id === active) && !words.length);
  // Dependent controls keep their place; availability follows the current settings.
  const shown = $derived(categories.map(category => ({
    ...category, keys: preferenceKeys.filter(key => {
      const item = preferenceFields[key];
      const text = `${category.label} ${item.group} ${item.label} ${key} ${item.kind === 'color' ? 'colour palette opacity' : ''} ${key === 'motion' ? 'animation accessibility' : ''} ${key === 'geography' ? 'borders map' : ''}`.toLowerCase();
      return item.category === category.id && words.every(word => text.includes(word));
    }),
  })).filter(category => category.keys.length));
  const visible = $derived(words.length ? shown : shown.filter(category => category.id === active));
  const matchingPages = $derived(words.length ? mappingPages.filter(page => words.every(word => `${page.label} mappings`.toLowerCase().includes(word))) : []);
  const found = $derived(shown.reduce((count, category) => count + category.keys.length, 0) + matchingPages.length);
  function showPage(page: string) { active = page; query = ''; }
  async function reset(keys: Parameters<typeof draft.reset>[0], label: string, target: HTMLElement) {
    notice = '';
    draft.reset(keys);
    for (const key of typeof keys === 'string' ? [keys] : keys) controlRevision[key] = (controlRevision[key] ?? 0) + 1;
    await tick();
    target.focus({ preventScroll: true });
    notice = `${label} reset to default.`;
  }
</script>

<Dialog label="Settings" closeLabel="Close settings" onclose={close}>
  <div class="preferences-bar">
    <SearchField label="Search settings" bind:this={search} bind:value={query}>
      {#snippet trailing()}<span class="found" role="status">{query.trim() ? `${found} found` : ''}</span>{/snippet}
    </SearchField>
  </div>
  <p class="sr-only" role="status">{notice}</p>
  <div class="property-layout">
    <div class="section-picker">
      <Icon name={categories.find(category => category.id === active)?.icon ?? 'mappings'} />
      <select aria-label="Settings section" value={active} onchange={event => showPage(event.currentTarget.value)}>
        <optgroup label="Settings">{#each categories as category (category.id)}<option value={category.id}>{category.label}</option>{/each}</optgroup>
        <optgroup label="Mappings">{#each mappingPages as page (page.id)}<option value={page.id}>{page.label} mappings</option>{/each}</optgroup>
      </select>
    </div>
    <nav class="property-nav" aria-label="Preference categories">
      <div class="preference-links">
        {#each categories as category (category.id)}
          <button class="category-link" aria-current={!words.length && active === category.id ? 'true' : undefined}
            onclick={() => showPage(category.id)}><Icon name={category.icon} /><span>{category.label}</span></button>
        {/each}
      </div>
      <div class="mapping-links" role="group" aria-label="Mappings">
        <span class="group-label">Mappings</span>
        {#each mappingPages as page (page.id)}
          <button class="category-link" aria-label={`${page.label} mappings`} aria-current={showingMappings && active === page.id ? 'true' : undefined}
            onclick={() => showPage(page.id)}><Icon name={page.icon} /><span>{page.label}</span></button>
        {/each}
      </div>
    </nav>
    <div class="property-list c-scroll-region" hidden={!showingMappings}>
      <section aria-label="Network mappings">
        <div class="property-heading mapping-heading">
          <h3>Network mappings</h3>
          {#if caseOpen}
            <fieldset class="mapping-scope" aria-label="Mapping scope">
              <label><input type="radio" bind:group={mappingScope} value="view" />This view</label>
              <label><input type="radio" bind:group={mappingScope} value="browser" />Browser defaults</label>
            </fieldset>
          {/if}
        </div>
        <fieldset aria-label="Mapping properties">
          <MappingEditor {document} preferences={draft} {geographic} {simulation} {measure} {band} scope={mappingScope}
            value={mappingScope === 'view' ? viewMappings : draft.mappings}
            onchange={operation => {
              if (mappingScope === 'browser') draft.editMappings(operation);
              else {
                const next = mappingDraft(viewMappings, () => defaultMarks(document.targets));
                operation(next);
                viewMappings = next.value;
              }
            }}
            oninvalid={value => { mappingInvalid = value; }} />
        </fieldset>
      </section>
    </div>
    {#key `${active}:${words.length > 0}`}
      <div class="property-list c-scroll-region" hidden={showingMappings}>
          {#each matchingPages as page (page.id)}
            <button class="mapping-result" onclick={() => showPage(page.id)}><Icon name={page.icon} />{page.label} mappings</button>
          {/each}
          {#each visible as category (category.id)}
            <section aria-labelledby={`${id}-${category.id}`}>
              <div class="property-heading"><h3 id={`${id}-${category.id}`} tabindex="-1">{category.label}</h3>
                <button class="reset-section" aria-label={`Reset ${category.label} section`}
                  disabled={!preferenceKeys.some(key => preferenceFields[key].category === category.id && (draft.modified(key) || invalidFields[key]))}
                  onclick={event => reset(preferenceKeys.filter(key => preferenceFields[key].category === category.id), category.label,
                    event.currentTarget.parentElement!.querySelector('h3')!)}>Reset section</button>
              </div>

              {#each category.keys as key, index (key)}
                {@const preference = preferenceFields[key]}
                {@const value = draft.get(key)}
                {@const modified = draft.modified(key)}
                {@const control = `${id}-${key}`}
                {@const label = category.id === 'appearance' ? preference.label : `${category.label} ${preference.group} ${preference.label}`.replace(/  /g, ' ')}
                {#if preference.group && (index === 0 || preferenceFields[category.keys[index - 1]!].group !== preference.group)}<h4>{preference.group}</h4>{/if}
                <div class={['property-row preference', { 'preference-url': preference.kind === 'url' }]} data-modified={modified || undefined}
                  role="group" aria-label={label} tabindex="-1">
                  <div class="preference-name"><label for={control}>{preference.label}</label>
                    <button disabled={!modified && !invalidFields[key]} class="c-icon-btn reset" aria-label={`Reset ${label}`} title="Reset to default"
                      onclick={event => reset(key, label, event.currentTarget.closest<HTMLElement>('.preference')!)}><Icon name="undo" /></button>
                  </div>
                  <div class="property-control">{#key controlRevision[key] ?? 0}<PreferenceControl {preference} {value} {label} id={control} disabled={!applies(key, draft.value)} oninvalid={next => { invalidFields[key] = next; }} onchange={next => draft.set(key, next)} />{/key}</div>
                </div>
              {/each}
            </section>
          {/each}
          {#if !visible.length && !matchingPages.length}
            <div class="preferences-empty"><p>No settings found.</p><button onclick={() => { query = ''; search?.focus(); }}>Clear search</button></div>
          {/if}
      </div>
    {/key}
  </div>
  {#snippet footer()}
    <button type="button" onclick={onclose}>Cancel</button>
    <button type="button" class="primary" title="Apply settings" disabled={!dirty || invalid} onclick={apply}>Apply</button>
  {/snippet}
</Dialog>

<style>
  .preferences-bar { padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
  .found { color: var(--color-text-2); font: var(--type-caption); white-space: nowrap; }
  .preference[data-modified]::before { content: ''; position: absolute; inset-block: 4px; left: 0; width: 1px; background: var(--color-primary-text); }
  .preference-name { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .preference-url { grid-template-columns: minmax(0, 1fr); gap: 8px; padding-block: 12px; }
  .reset { width: var(--control-height); height: var(--control-height); min-height: var(--control-height); flex-shrink: 0; }
  .reset :global(svg) { width: 12px; height: 12px; }
  .preferences-empty { color: var(--color-text-2); padding-block: 16px; }
  .mapping-links { margin-top: var(--spacing-md); padding-top: var(--spacing-sm); border-top: 1px solid var(--color-border); }
  .group-label { display: block; padding: 0 8px 4px; color: var(--color-text-3); font: var(--type-caption); }
  .mapping-heading { flex-wrap: wrap; }
  .mapping-scope { display: flex; flex-wrap: wrap; gap: var(--spacing-md); font: var(--type-compact); }
  .mapping-scope label, .mapping-result { display: flex; align-items: center; gap: var(--spacing-sm); }
  .mapping-scope label { min-height: var(--control-height); font: inherit; white-space: nowrap; }
  .mapping-result { width: 100%; text-align: left; }
  .section-picker { display: none; }
  @media (max-width: 767px) {
    .property-nav { display: none; }
    .section-picker { display: flex; flex: none; align-items: center; gap: 8px; padding: 4px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-2); }
    .section-picker select { flex: 1; min-width: 0; }
    .section-picker :global(svg) { width: 14px; height: 14px; flex: none; }
  }

</style>
