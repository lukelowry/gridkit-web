<script lang="ts">
  import { detailsOf, type Case } from '@gridkit/library';
  import Dialog from '../ui/Dialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import PropertySections from '../ui/PropertySections.svelte';
  let { value, disabled = false, onclose, ondownload }: {
    value: Pick<Case, 'header' | 'params'>; disabled?: boolean; onclose: () => void; ondownload: () => void;
  } = $props();
  const id = $props.id();
  const details = $derived(detailsOf(value));
  const sections = [
    { id: 'details', label: 'Details', icon: 'info' },
    { id: 'bases', label: 'Base values', icon: 'settings' },
    { id: 'comments', label: 'Comments', icon: 'file' },
  ] as const;
</script>

<Dialog label="Case information" closeLabel="Close case information" {onclose}>
  <div class="dialog-form">
    <PropertySections label="Case sections" {sections}>
      <fieldset {disabled}>
        <legend class="sr-only">Case details</legend>
        <section data-section="details" aria-labelledby={`${id}-details`}>
          <h3 id={`${id}-details`}>Details</h3>
          <div class="property-row">
            <label for={`${id}-name`}>Name</label>
            <div class="property-control"><input readonly id={`${id}-name`} value={details.case_name} /></div>
          </div>
          <div class="property-row text-row">
            <label for={`${id}-description`}>Description</label>
            <div class="property-control"><textarea readonly id={`${id}-description`} rows="3" value={details.case_description}></textarea></div>
          </div>
        </section>
        <section data-section="bases" aria-labelledby={`${id}-bases`}>
          <h3 id={`${id}-bases`}>Base values</h3>
          <div class="property-row">
            <label for={`${id}-frequency`}>Frequency base <span class="field-unit">Hz</span></label>
            <div class="property-control property-field"><input readonly id={`${id}-frequency`} aria-label="Frequency base (Hz)" type="number" step="any" min="0" required value={details.freq_base} />
            </div>
          </div>
          <div class="property-row">
            <label for={`${id}-power`}>Power base <span class="field-unit">VA</span></label>
            <div class="property-control property-field"><input readonly id={`${id}-power`} aria-label="Power base (VA)" type="number" step="any" min="0" required value={details.va_base} />
            </div>
          </div>
        </section>
        <section data-section="comments" aria-labelledby={`${id}-comments`}>
          <h3 id={`${id}-comments`}>Comments</h3>
          <div class="property-row text-row">
            <label class="sr-only" for={`${id}-notes`}>Comments</label>
            <div class="property-control"><textarea readonly id={`${id}-notes`} rows="4" value={details.case_comments}></textarea></div>
          </div>
        </section>
      </fieldset>
    </PropertySections>
  </div>
  {#snippet leading()}
    <button type="button" class="c-icon-btn" aria-label="Download case" title="Download case" {disabled} onclick={ondownload}><Icon name="download" /></button>
  {/snippet}
  {#snippet footer()}
    <button type="button" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>

<style>
  fieldset { gap: 0; }
  .text-row { grid-template-columns: minmax(0, 1fr); gap: 8px; padding-block: 12px; }
</style>
