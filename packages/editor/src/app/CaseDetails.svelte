<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { baseIssues, detailsOf, type Case, type Details } from '@gridkit/library';
  import Dialog from '../ui/Dialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import PropertySections from '../ui/PropertySections.svelte';

  let { value, disabled = false, onapply, onpending, onclose, ondownload }: {
    value: Pick<Case, 'header' | 'params'>;
    disabled?: boolean;
    onapply: (details: Details) => void;
    onpending: (pending: boolean) => void;
    onclose: () => void;
    ondownload: () => void;
  } = $props();
  const id = $props.id();
  const baseline = untrack(() => detailsOf(value));
  let draft = $state<Omit<Details, 'freq_base' | 'va_base'> & {
    freq_base: number | undefined;
    va_base: number | undefined;
  }>({ ...baseline });
  const dirty = $derived(Object.entries(baseline).some(([key, field]) => draft[key as keyof Details] !== field));
  const errors = $derived(Object.fromEntries(baseIssues(draft).map(issue => [issue.field, issue.message])));
  const sections = [
    { id: 'details', label: 'Details', icon: 'info' },
    { id: 'bases', label: 'Base values', icon: 'settings' },
    { id: 'comments', label: 'Comments', icon: 'file' },
  ] as const;

  $effect(() => onpending(dirty));
  onDestroy(() => onpending(false));

  function close() {
    if (!dirty || window.confirm('Discard changes to case information?')) onclose();
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const { freq_base, va_base } = draft;
    if (disabled || Object.keys(errors).length || freq_base === undefined || va_base === undefined) return;
    onapply({ ...draft, freq_base, va_base });
    onpending(false);
    onclose();
  }
</script>

<Dialog label="Case information" closeLabel="Close case information" onclose={close}>
  <form {id} class="dialog-form" onsubmit={submit}>
    <PropertySections label="Case sections" {sections}>
      <fieldset {disabled}>
        <legend class="sr-only">Case details</legend>
        <section data-section="details" aria-labelledby={`${id}-details`}>
          <h3 id={`${id}-details`}>Details</h3>
          <div class="property-row">
            <label for={`${id}-name`}>Name</label>
            <div class="property-control"><input id={`${id}-name`} bind:value={draft.case_name} /></div>
          </div>
          <div class="property-row text-row">
            <label for={`${id}-description`}>Description</label>
            <div class="property-control"><textarea id={`${id}-description`} rows="3" bind:value={draft.case_description}></textarea></div>
          </div>
        </section>
        <section data-section="bases" aria-labelledby={`${id}-bases`}>
          <h3 id={`${id}-bases`}>Base values</h3>
          <div class="property-row">
            <label for={`${id}-frequency`}>Frequency base <span class="field-unit">Hz</span></label>
            <div class="property-control property-field"><input id={`${id}-frequency`} aria-label="Frequency base (Hz)" type="number" step="any" min="0" required bind:value={draft.freq_base}
              aria-invalid={!!errors.freq_base || undefined} aria-describedby={errors.freq_base ? `${id}-frequency-error` : undefined} />
              {#if errors.freq_base}<p class="field-error" id={`${id}-frequency-error`}>{errors.freq_base}</p>{/if}
            </div>
          </div>
          <div class="property-row">
            <label for={`${id}-power`}>Power base <span class="field-unit">VA</span></label>
            <div class="property-control property-field"><input id={`${id}-power`} aria-label="Power base (VA)" type="number" step="any" min="0" required bind:value={draft.va_base}
              aria-invalid={!!errors.va_base || undefined} aria-describedby={errors.va_base ? `${id}-power-error` : undefined} />
              {#if errors.va_base}<p class="field-error" id={`${id}-power-error`}>{errors.va_base}</p>{/if}
            </div>
          </div>
        </section>
        <section data-section="comments" aria-labelledby={`${id}-comments`}>
          <h3 id={`${id}-comments`}>Comments</h3>
          <div class="property-row text-row">
            <label class="sr-only" for={`${id}-notes`}>Comments</label>
            <div class="property-control"><textarea id={`${id}-notes`} rows="4" bind:value={draft.case_comments}></textarea></div>
          </div>
        </section>
      </fieldset>
    </PropertySections>
  </form>
  {#snippet leading()}
    <button type="button" class="c-icon-btn" aria-label="Download case" title={dirty ? 'Apply changes before downloading' : 'Download case'} disabled={disabled || dirty} onclick={ondownload}><Icon name="download" /></button>
  {/snippet}
  {#snippet footer()}
    <button type="button" onclick={onclose}>Cancel</button>
    <button type="submit" form={id} class="primary" disabled={disabled || !dirty || Object.keys(errors).length > 0}>Apply</button>
  {/snippet}
</Dialog>

<style>
  fieldset { gap: 0; }
  .text-row { grid-template-columns: minmax(0, 1fr); gap: 8px; padding-block: 12px; }
</style>
