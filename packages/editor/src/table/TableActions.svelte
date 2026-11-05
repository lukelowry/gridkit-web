<script lang="ts">
  import type TableView from './TableView.svelte';
  import ClassPicker from './ClassPicker.svelte';
  import TableColumns from './TableColumns.svelte';
  let { table }: { table: TableView } = $props();
  const state = $derived(table.controls());
</script>
<div class="table-actions" role="group" aria-label="Table controls">
  <div class="class-filter"><ClassPicker entries={state.entries} bind:value={() => state.selectedClass, state.select} label="Table class" allLabel="All classes" /></div>
  <TableColumns columns={state.columns} onupdate={state.update} onmove={state.move} onreset={state.reset} />
</div>
<style>
  .table-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .class-filter { min-width: 0; max-width: 12rem; }
</style>
