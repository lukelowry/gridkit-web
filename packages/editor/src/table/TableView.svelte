<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { Entry } from '../domain/entries.js';
  import { classKey, classesOf, columnsOf, tableSource } from './rows.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import type { TableSort } from '../ui/table.js';
  import VirtualTable from '../ui/VirtualTable.svelte';
  import ClassPicker from './ClassPicker.svelte';
  import TableColumns from './TableColumns.svelte';
  import type { FieldInfo, ElementTarget } from '@gridkit/library';

  let { entries, selected, preferences, fields, active, query = '', onresults, editActions, addActions, onselect, onopen, onmenu }: {
    entries: readonly Entry[]; selected: Entry | null; preferences: PreferencesState; query?: string;
    active: boolean;
    onresults: (total: number) => void;
    editActions: Snippet;
    /** How the table adds elements. */
    addActions: Snippet;
    fields: (target: ElementTarget) => readonly FieldInfo[];
    onselect: (entry: Entry | null) => void;
    onopen: (entry: Entry) => void;
    onmenu: (entry: Entry, at: { readonly x: number; readonly y: number }) => void;
  } = $props();
  let selectedClass = $state('');
  let table = $state<VirtualTable>();
  // A hidden table keeps the entries it last showed, so edits elsewhere cost it nothing, and catches up once shown.
  let last: readonly Entry[] = [];
  const shown = $derived.by(() => active ? (last = entries) : last);
  const matching = $derived(shown.filter(entry => !selectedClass || classKey(entry) === selectedClass));
  const available = $derived(columnsOf(matching, selectedClass, matching[0] ? fields(matching[0]) : []));
  const saved = $derived(preferences.table(selectedClass));
  const ordered = $derived([
    ...saved.columns.filter(column => column.key !== 'class' && available.some(item => item.key === column.key)),
    ...available.filter(column => column.key !== 'class' && !saved.columns.some(item => item.key === column.key))
      .map(column => ({ ...column, visible: true })),
  ].map(column => ({ ...available.find(item => item.key === column.key)!, ...column })));
  const columns = $derived([...available.filter(column => column.key === 'class'), ...ordered.filter(column => column.visible)]);
  const source = $derived(tableSource(matching, columns));
  const byId = $derived(new Map(shown.map(entry => [entry.id, entry])));
  const selectedKey = $derived(selected?.id ?? null);
  const classes = $derived(classesOf(shown));
  const label = $derived(classes.find(item => item.key === selectedClass)?.display ?? 'All classes');
  const sort = $derived<TableSort | null>(saved.sort && (saved.sort.key === 'id' || columns.some(column => column.key === saved.sort!.key))
    ? { column: saved.sort.key === 'id' ? null : columns.findIndex(column => column.key === saved.sort!.key), dir: saved.sort.dir } : null);

  // Reveal selections made in another view without changing the filter on ordinary row clicks.
  $effect(() => {
    const entry = selected;
    untrack(() => {
      if (entry && selectedClass && classKey(entry) !== selectedClass) selectedClass = classKey(entry);
    });
  });
  export function focus() { table?.focus(); }
  function update(key: string, patch: { width?: number; visible?: boolean }) {
    preferences.setTable(selectedClass, { columns: ordered.map(column => column.key === key ? { ...column, ...patch } : column) });
  }
  function move(key: string, direction: number) {
    const next = [...ordered];
    const index = next.findIndex(column => column.key === key);
    const item = next.splice(index, 1)[0]!;
    next.splice(index + direction, 0, item);
    preferences.setTable(selectedClass, { columns: next });
  }
</script>

<section class="case-table" aria-label="Case table" style:--table-row-height={preferences.value.tableDensity === 'comfortable' ? '40px' : '32px'}>
  <VirtualTable id="case-elements" bind:this={table} {source} {columns} identity={{ label: 'ID', width: 96 }} {label} {query} resetKey={selectedClass}
    retainSelection={!active}
    emptyText={query.trim() ? 'No matching elements. Clear the search or choose another class.' : 'No elements in this class.'}
    {onresults}
    onopen={key => { const entry = byId.get(key); if (entry) onopen(entry); }}
    onmenu={(key, at) => { const entry = byId.get(key); if (entry) onmenu(entry, at); }}
    bind:sort={() => sort, next => preferences.setTable(selectedClass, {
      sort: next ? { key: next.column === null ? 'id' : columns[next.column]!.key, dir: next.dir } : null,
    })}
    bind:selected={() => selectedKey, key => {
      const entry = key === null ? undefined : byId.get(key);
      onselect(entry ?? null);
    }}>
    {#snippet actions()}
      <ClassPicker entries={shown} bind:value={selectedClass} label="Table class" allLabel="All classes" />
      {@render editActions()}
      {@render addActions()}
      <TableColumns columns={ordered} onupdate={update} onmove={move}
        onreset={() => preferences.setTable(selectedClass, { columns: [] })} />
    {/snippet}
  </VirtualTable>
</section>

<style>
  .case-table { display: flex; height: 100%; min-height: 0; }
</style>
