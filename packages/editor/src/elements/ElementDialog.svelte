<script lang="ts">
  import { untrack } from 'svelte';
  import { elementCatalog, elementIssues, portsOf, type CaseDocument, type ElementRef } from '@gridkit/library';
  import { fieldsOf } from './fields.js';
  import Dialog from '../ui/Dialog.svelte';
  import FieldValues from './FieldValues.svelte';
  import PropertySections from '../ui/PropertySections.svelte';
  import type { IconName } from '../ui/icons.js';

  let { document, ref, onclose }: { document: CaseDocument; ref: ElementRef; onclose: () => void } = $props();
  const row = untrack(() => document.get(ref)!);
  const { collection } = row.ref, value = row.value;
  const kind = collection === 'signals' ? 'Signal' : String(value.class);
  const definition = elementCatalog.get(kind);
  const metadata = untrack(() => document.fields({ collection, class: kind }));
  const identifier = String(collection === 'buses' ? value.number : collection === 'signals' ? value.signal_id : value.id);
  const name = collection !== 'devices' || typeof value.name === 'string' ? String(value.name ?? '') : undefined;
  const params = collection !== 'signals' ? fieldsOf(value.params, metadata, 'params.') : undefined;
  const init = definition?.init || value.init && typeof value.init === 'object' ? fieldsOf(value.init, metadata, 'init.') : undefined;
  const connections = portsOf(row);
  const ports = [...new Set([...Object.keys(definition?.ports ?? {}), ...Object.keys(connections)])].map(key => {
    const connection = connections[key];
    return { key, label: definition?.ports[key]?.label ?? key,
      text: connection == null ? 'Not connected' : typeof connection === 'number' ? String(connection) : connection.id };
  });
  const completion = untrack(() => elementIssues(document, row));
  const sections: readonly { id: string; label: string; icon: IconName }[] = [
    { id: 'details', label: 'Details', icon: 'info' },
    ...(ports.length ? [{ id: 'connections', label: 'Connections', icon: 'network' as const }] : []),
    ...(params ? [{ id: 'parameters', label: 'Parameters', icon: 'settings' as const }] : []),
    ...(init ? [{ id: 'initial', label: 'Initial values', icon: 'table' as const }] : []),
  ];
  const id = $props.id();
</script>

<Dialog label={kind + ' ' + identifier} closeLabel="Close element" {onclose}>
  <div class="dialog-form">
    <PropertySections label="Element sections" {sections}>
      <section data-section="details" aria-label="Details">
        <h3>Details</h3>
        {#if completion.length}
          <details class="completion"><summary>Needs attention ({completion.length})</summary>
            <ul>{#each completion as issue, index (index)}<li>{issue.message}</li>{/each}</ul>
          </details>
        {/if}
        <div class="property-row"><label for={id + '-identifier'}>{collection === 'devices' ? 'ID' : 'Number'}</label><div class="property-control"><input id={id + '-identifier'} readonly value={identifier} /></div></div>
        <div class="property-row"><span class="property-label">Class</span><span class="identity-value">{kind}</span></div>
        {#if name !== undefined}<div class="property-row"><label for={id + '-name'}>Name</label><div class="property-control"><input id={id + '-name'} aria-label="Element name" readonly value={name} /></div></div>{/if}
      </section>
      {#if ports.length}
        <section data-section="connections" aria-label="Connections"><h3>Connections</h3>
          {#each ports as port, index (port.key)}<div class="property-row"><label for={id + '-port-' + index} title={port.key}>{port.label}</label><div class="property-control"><input id={id + '-port-' + index} readonly value={port.text} /></div></div>{/each}
        </section>
      {/if}
      {#if params}<section data-section="parameters" aria-label="Parameters"><h3>Parameters</h3><FieldValues fields={params} label="Parameters" /></section>{/if}
      {#if init}<section data-section="initial" aria-label="Initial values"><h3>Initial values</h3><FieldValues fields={init} label="Initial values" /></section>{/if}
    </PropertySections>
  </div>
  {#snippet footer()}<button type="button" onclick={onclose}>Close</button>{/snippet}
</Dialog>
<style>
  .completion { color: var(--color-text-3); font: var(--type-compact); margin-bottom: var(--spacing-md); }
  .identity-value { color: var(--color-text-3); overflow-wrap: anywhere; }
</style>
