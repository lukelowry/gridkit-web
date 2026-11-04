<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { CaseDocument } from '@gridkit/library';
  import type { Study } from '@gridkit/library/gridkit';
  import type { SolverRequest } from '../app/workspace.svelte.js';
  import { errorMessage } from '../ui/errors.js';
  import Icon from '../ui/Icon.svelte';
  import Popover from '../ui/Popover.svelte';
  import SolverSettings from './SolverSettings.svelte';

  let { document, study, request, canRun, busy, unavailableReason, onretry, onrun, onstudy, onstudyexport, onpending }: {
    document: CaseDocument; study: Study; request: SolverRequest | null;
    canRun: boolean; busy: boolean; unavailableReason: string; onretry?: (() => void) | undefined;
    onrun: () => void; onstudy: (study: Study) => void; onstudyexport: (study: Study) => void;
    onpending: (pending: boolean) => void;
  } = $props();
  // Mounted once per case: changing views preserves the form, raw JSON and scroll position.
  let draft = $state<Study>(untrack(() => structuredClone(request?.study ?? study)));
  let baseline = $state(untrack(() => JSON.stringify(study)));
  let initialEvent = $state(untrack(() => request?.initialEvent ?? 0));
  let acceptedStudy = untrack(() => study), acceptedRequest = untrack(() => request);
  let revision = $state(0), invalid = $state(false), error = $state(''), notice = $state('');
  let form = $state<SolverSettings>(), heading: HTMLHeadingElement;
  const dirty = $derived(JSON.stringify(draft) !== baseline);
  const pending = $derived(dirty || invalid);
  const id = $props.id();
  $effect(() => onpending(pending));
  onDestroy(() => onpending(false));
  $effect(() => {
    const next = study, seed = request;
    untrack(() => {
      if (seed !== acceptedRequest && seed) replace(seed.study, seed.initialEvent);
      else if (next !== acceptedStudy && (invalid || JSON.stringify(draft) !== JSON.stringify(next))) replace(next);
      baseline = JSON.stringify(next);
      acceptedStudy = next; acceptedRequest = seed;
    });
  });
  function replace(next: Study, event = 0) {
    draft = structuredClone(next); initialEvent = event; invalid = false; error = ''; notice = ''; revision++;
  }
  export function focus() { heading?.focus({ preventScroll: true }); }
  function apply(run = false) {
    if (invalid || (run && !canRun)) return;
    error = ''; notice = '';
    try {
      onstudy($state.snapshot(draft));
      baseline = JSON.stringify(draft); onpending(false);
      if (run) onrun();
      else notice = 'Solver settings applied.';
      // Apply disappears when clean; keep focus on a stable, non-editing target.
      focus();
    } catch (cause) { error = errorMessage(cause, 'Could not apply solver settings.'); }
  }
</script>

<section class="solver-view" aria-labelledby={id}>
  <div class="solver-header">
    <h2 id={id} tabindex="-1" bind:this={heading}>Solver</h2>
    <div class="solver-actions">
      {#if pending}<button type="button" disabled={invalid} onclick={() => apply()}>Apply</button>{/if}
      <button type="button" class="primary run" aria-label="Run simulation" disabled={!canRun || invalid}
        aria-describedby={!canRun ? `${id}-availability` : invalid ? `${id}-invalid` : undefined} onclick={() => apply(true)}><Icon name="play" />Run</button>
      <Popover label="Solver options" width={240} align="end">
        {#snippet trigger(popup)}<button class="c-icon-btn" aria-label="Solver options" title="Solver options" aria-haspopup="dialog" popovertarget={popup}><Icon name="more" /></button>{/snippet}
        {#snippet children(close)}
          <div class="c-options">
            <button class="c-action" onclick={() => { close(); form?.importSettings(); }}><Icon name="open" />Import solver settings</button>
            <button class="c-action" disabled={invalid} onclick={() => { close(); void form?.download(); }}><Icon name="download" />Download solver settings</button>
          </div>
          <div class="c-options">
            <button class="c-action" disabled={!pending} onclick={() => { close(); replace(study); focus(); }}><Icon name="undo" />Discard edits</button>
            <button class="c-action" onclick={() => { close(); form?.reset(); focus(); }}><Icon name="undo" />Reset solver settings</button>
          </div>
        {/snippet}
      </Popover>
    </div>
  </div>
  <div class="solver-body property-list c-scroll-region">
    <div class="solver-form">
      {#if !canRun}<p class="solver-message" id={`${id}-availability`} role="status">{busy ? 'Simulation running. Changes apply to the next run.' : unavailableReason || 'Simulation unavailable.'}
        {#if onretry}<button onclick={onretry}>Retry connection</button>{/if}
      </p>{/if}
      {#if invalid}<p class="solver-message" id={`${id}-invalid`}><button onclick={() => form?.focusIssue()}><Icon name="warning" />Review solver edits</button></p>{/if}
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <p class="sr-only" role="status">{notice}</p>
      {#key revision}<SolverSettings bind:this={form} {document} bind:value={draft} {initialEvent} onexport={onstudyexport} oninvalid={next => { invalid = next; }} />{/key}
    </div>
  </div>
</section>

<style>
  .solver-view { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
  .solver-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-lg); border-bottom: 1px solid var(--color-border); background: var(--color-surface-1); }
  .solver-header h2 { min-width: 0; }
  .solver-actions, .run { display: flex; align-items: center; gap: var(--spacing-xs); }
  .solver-actions { margin-inline-start: auto; flex-wrap: wrap; }
  .solver-body { flex: 1; padding-top: var(--spacing-lg); }
  .solver-form { max-width: 48rem; }
  .solver-message { display: flex; align-items: center; flex-wrap: wrap; gap: var(--spacing-sm); margin: 0 0 var(--spacing-md); color: var(--color-text-2); font: var(--type-compact); }
  .solver-message button { display: inline-flex; align-items: center; gap: var(--spacing-xs); }
</style>
