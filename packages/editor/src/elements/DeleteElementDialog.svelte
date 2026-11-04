<script lang="ts">
  import type { Entry } from '../domain/entries.js';
  import { errorMessage } from '../ui/errors.js';
  import Dialog from '../ui/Dialog.svelte';

  let { entry, dependents, ondelete, onclose }: {
    entry: Entry; dependents: readonly Entry[]; ondelete: () => void; onclose: () => void;
  } = $props();
  let error = $state('');
  function remove() {
    try { ondelete(); }
    catch (cause) { error = errorMessage(cause, 'Could not delete this element.'); }
  }
</script>

<Dialog label={`Delete ${entry.class} ${entry.label}?`} compact {onclose}>
  <div class="delete-content">
    <p>This also deletes {dependents.length} connected {dependents.length === 1 ? 'element' : 'elements'}:</p>
    <ul>{#each dependents as item (item.id)}<li>{item.class} {item.label}{item.name ? ` (${item.name})` : ''}</li>{/each}</ul>
    <p class="property-empty">You can undo this deletion.</p>
    {#if error}<p class="field-error" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <button type="button" {@attach element => { queueMicrotask(() => element.focus()); }} onclick={onclose}>Keep element</button>
    <button type="button" class="danger" onclick={remove}>Delete {dependents.length + 1} elements</button>
  {/snippet}
</Dialog>

<style>
  .delete-content { padding: var(--spacing-lg); overflow: auto; font: var(--type-compact); }
  p { margin-block: 0 var(--spacing-md); }
  ul { padding-left: var(--spacing-lg); margin-block: var(--spacing-md); }
</style>
