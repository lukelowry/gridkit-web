<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { collectionLabel } from '../domain/entries.js';
  import { ElementValidationError, type CaseDocument } from '@gridkit/library';
  import { errorMessage } from '../ui/errors.js';
  import { createElementDraft, draftSignature, submitElementDraft, elementDraftIssues, portRequired, DraftError, type ElementRequest, type ElementSubmission } from './draft.js';
  import Dialog from '../ui/Dialog.svelte';
  import FieldEditor from './FieldEditor.svelte';
  import PropertySections from '../ui/PropertySections.svelte';
  import Icon from '../ui/Icon.svelte';
  import type { IconName } from '../ui/icons.js';
  import ConnectionPicker from './ConnectionPicker.svelte';

  let { document, request, oncommit, ondelete, onclose, onpending }: {
    document: CaseDocument; request: ElementRequest;
    oncommit: (submission: ElementSubmission) => void; ondelete: () => void;
    onclose: () => void; onpending: (pending: boolean) => void;
  } = $props();
  const id = $props.id();
  const initial = untrack(() => createElementDraft(document, request));
  const title = `${initial.kind} ${initial.identifier}`;
  let draft = $state(initial);
  const baseline = draftSignature(initial);
  const completion = $derived(elementDraftIssues(document, request, draft));
  let activeSection = $state('details');
  const dirty = $derived(draftSignature(draft) !== baseline);
  const sections: readonly { id: string; label: string; icon: IconName; group?: string; panel?: boolean }[] = [
    { id: 'details', label: 'Details', icon: 'info' },
    ...(initial.ports.length ? [{ id: 'connections', label: 'Connections', icon: 'network' as const }] : []),
    ...(initial.params ? [{ id: 'parameters', label: 'Parameters', icon: 'settings' as const }] : []),
    ...(initial.init ? [{ id: 'initial', label: 'Initial values', icon: 'table' as const }] : []),
  ];
  let form = $state<HTMLFormElement>();
  let errors = $state<Record<string, string>>({});
  let error = $state('');
  $effect(() => onpending(dirty));
  onDestroy(() => onpending(false));

  function close() {
    if (!dirty || window.confirm('Discard changes to this element?')) onclose();
  }
  function clearError(event: Event) {
    const key = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-field]')?.dataset.field : undefined;
    if (key) delete errors[key];
    error = '';
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errors = {}; error = '';
    try {
      oncommit(submitElementDraft(document, request, draft));
      onclose();
    } catch (cause) {
      if (cause instanceof DraftError) errors = cause.issues;
      else if (cause instanceof ElementValidationError && cause.field !== 'ports') errors = { [cause.field]: cause.message };
      else error = errorMessage(cause, 'Could not apply changes.');
      await tick();
      const invalid = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const section = invalid?.closest<HTMLElement>('[data-section]')?.dataset.section;
      if (section) { activeSection = section; await tick(); }
      invalid?.focus();
      invalid?.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

<Dialog label={title} closeLabel="Close element" onclose={close}>
    <form id={id} class="dialog-form" bind:this={form} novalidate onsubmit={submit} oninput={clearError} onchange={clearError}>
      <PropertySections label="Element sections" {sections} bind:active={activeSection}>
        <section data-section="details" aria-label="Details">
          <h3>Details</h3>
          {#if completion.length}
            <details class="completion"><summary>Needs attention ({completion.length})</summary>
              <ul>{#each completion as issue, index (index)}<li>{issue.message}</li>{/each}</ul>
            </details>
          {/if}
          <div class="property-row" data-field="identifier">
            <label for={`${id}-identifier`}>{draft.collection === 'devices' ? 'ID' : 'Number'}</label>
            <div class="property-control property-field">
              <input id={`${id}-identifier`} type={draft.collection === 'devices' ? 'text' : 'number'} step="1" min="0" required
                value={draft.identifier} oninput={event => { draft.identifier = event.currentTarget.value; }}
                aria-invalid={!!errors.identifier || undefined} aria-describedby={errors.identifier ? `${id}-identifier-error` : undefined} />
              {#if errors.identifier}<p class="field-error" id={`${id}-identifier-error`}>{errors.identifier}</p>{/if}
            </div>
          </div>
          <div class="property-row"><span class="property-label">Class</span><span class="identity-value">{draft.kind}</span></div>
          {#if draft.name !== undefined}
            <div class="property-row"><label for={`${id}-name`}>Name</label>
              <div class="property-control"><input id={`${id}-name`} aria-label="Element name" bind:value={draft.name} /></div></div>
          {/if}
        </section>
        {#if draft.ports.length}
          <section data-section="connections" aria-label="Connections">
            <h3>Connections</h3>
            {#each draft.ports as port, index (port.key)}
              {@const issue = errors[`ports.${port.key}`]}
              <div class="property-row" data-field={`ports.${port.key}`}>
                <label for={`${id}-port-${index}`} title={port.key}>{port.label}</label>
                <div class="property-control property-field">
                  {#if port.target && port.choices}
                    <ConnectionPicker id={`${id}-port-${index}`} label={port.label} choices={port.choices}
                      collectionLabel={port.target === 'signals' ? 'Signals and ports' : collectionLabel[port.target]} bind:value={port.text} invalid={!!issue}
                      describedby={issue ? `${id}-port-${index}-error` : undefined} onchange={() => { delete errors[`ports.${port.key}`]; }} />
                  {:else}
                    <input id={`${id}-port-${index}`} aria-label={port.label} type="number" step="1" required
                      value={port.text} oninput={event => { port.text = event.currentTarget.value; }}
                      aria-invalid={!!issue || undefined} aria-describedby={issue ? `${id}-port-${index}-error` : undefined} />
                  {/if}
                  {#if portRequired(draft, port) && !port.text}<p class="property-empty">Required connection</p>{/if}
                  {#if issue}<p class="field-error" id={`${id}-port-${index}-error`}>{issue}</p>{/if}
                </div>
              </div>
            {/each}
          </section>
        {/if}
        {#if draft.params}<section data-section="parameters" aria-label="Parameters"><h3>Parameters</h3><FieldEditor bind:fields={draft.params} label="Parameters" group="params" {errors} /></section>{/if}
        {#if draft.init}<section data-section="initial" aria-label="Initial values"><h3>Initial values</h3><FieldEditor bind:fields={draft.init} label="Initial values" group="init" {errors} /></section>{/if}
        {#if error}<p role="alert">{error}</p>{/if}
        <span class="sr-only" role="status">{Object.keys(errors).length ? 'Check the highlighted fields.' : ''}</span>
      </PropertySections>
    </form>
  {#snippet leading()}
      <button type="button" class="c-icon-btn danger" aria-label="Delete element" title="Delete element" onclick={ondelete}><Icon name="trash" /></button>
  {/snippet}
  {#snippet footer()}
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" form={id} class="primary" disabled={!dirty}>Apply</button>
  {/snippet}
</Dialog>

<style>
  .completion { color: var(--color-text-3); font: var(--type-compact); margin-bottom: var(--spacing-md); }
  .identity-value { color: var(--color-text-3); overflow-wrap: anywhere; }
</style>
