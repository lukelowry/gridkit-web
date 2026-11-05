<script lang="ts">
  import type { CaseIssue, ElementRef } from '@gridkit/library';
  import type { Entry } from '../domain/entries.js';
  import Dialog from '../ui/Dialog.svelte';

  let { issues, lookup, onopen, onclose, ondownload }: {
    issues: readonly CaseIssue[]; lookup: (ref: ElementRef) => Entry | undefined;
    onopen: (ref: ElementRef | null) => void; onclose: () => void; ondownload: () => void;
  } = $props();
  const elements = $derived.by(() => {
    const groups = new Map<string, { ref: ElementRef | null; label: string; messages: Set<string> }>();
    for (const issue of issues) {
      const entry = issue.ref ? lookup(issue.ref) : undefined;
      const key = issue.ref?.id ?? 'case';
      let group = groups.get(key);
      if (!group) {
        group = { ref: issue.ref, label: entry ? `${entry.class} ${entry.label}` : issue.ref?.id ?? 'Case information', messages: new Set() };
        groups.set(key, group);
      }
      group.messages.add(issue.message);
    }
    return [...groups.values()];
  });
</script>

<Dialog label="Needs attention" closeLabel="Close case issues" {onclose}>
  <div class="issues">
    <p>Correct these issues in the source case before simulation.</p>
    <ul>
      {#each elements as element (element.ref?.id ?? 'case')}
        <li><button type="button" onclick={() => onopen(element.ref)} aria-label={`View ${element.label}`}>
          <strong>{element.label}</strong>
          {#each [...element.messages] as message (message)}<span>{message}</span>{/each}
        </button></li>
      {/each}
    </ul>
  </div>
  {#snippet footer()}
    <button type="button" onclick={onclose}>Close</button>
    <button type="button" onclick={ondownload}>Download unfinished case</button>
  {/snippet}
</Dialog>

<style>
  .issues { overflow: auto; padding: var(--spacing-lg); font: var(--type-compact); }
  p { margin: 0 0 var(--spacing-md); }
  ul { padding: 0; margin: 0; list-style: none; }
  li { border-bottom: 1px solid var(--color-divider); }
  li button { display: grid; gap: var(--spacing-xs); width: 100%; padding: var(--spacing-md) var(--spacing-sm); text-align: left; }
  span { color: var(--color-text-2); }
</style>
