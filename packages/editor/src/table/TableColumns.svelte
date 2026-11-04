<script lang="ts">
  import type { TableColumn } from '../ui/table.js';
  import Icon from '../ui/Icon.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import Popover from '../ui/Popover.svelte';

  let { columns, onupdate, onmove, onreset }: {
    columns: readonly (TableColumn & { visible: boolean })[];
    onupdate: (key: string, patch: { width?: number; visible?: boolean }) => void;
    onmove: (key: string, direction: number) => void;
    onreset: () => void;
  } = $props();
  let query = $state('');
  const shown = $derived(columns.filter(column => `${column.label} ${column.group ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
</script>

<Popover label="Columns" width={400} align="end" onopen={() => { query = ''; }}>
  {#snippet trigger(id)}<button class="c-icon-btn" aria-label="Columns" title="Columns" popovertarget={id}><Icon name="columns" /></button>{/snippet}
  {#snippet children(close)}
    <header><h2>Columns</h2><button class="c-icon-btn" aria-label="Close columns" title="Close columns" onclick={close}><Icon name="close" /></button></header>
    {#if columns.length > 6}<div class="column-search"><SearchField label="Find columns" bind:value={query} /></div>{/if}
    <div class="column-list">
      <div class="column-captions" aria-hidden="true"><span>Visible columns</span><span>Width</span><span>Order</span></div>
      {#each shown as column (column.key)}
        {@const index = columns.findIndex(item => item.key === column.key)}
        <div class="column-row">
          <label class="column-name"><input type="checkbox" checked={column.visible}
            aria-label={`Show ${column.group ? `${column.group} ` : ''}${column.label}`}
            onchange={event => onupdate(column.key, { visible: event.currentTarget.checked })} />
            <span><span>{column.label}</span>{#if column.group}<small>{column.group}</small>{/if}</span>
          </label>
          <label class="c-field column-width"><span class="sr-only">{column.group ? `${column.group} ` : ''}{column.label} width</span>
            <input type="number" min="60" max="600" step="10" value={column.width}
              onchange={event => {
                const width = Math.min(600, Math.max(60, event.currentTarget.valueAsNumber || column.width));
                onupdate(column.key, { width });
                event.currentTarget.value = String(width);
              }} /><span class="c-field__suffix" aria-hidden="true">px</span>
          </label>
          <div class="column-order">
            <button class="c-icon-btn" aria-label={`Move ${column.label} left`} title="Move left" disabled={index === 0} onclick={() => onmove(column.key, -1)}><Icon name="up" /></button>
            <button class="c-icon-btn" aria-label={`Move ${column.label} right`} title="Move right" disabled={index === columns.length - 1} onclick={() => onmove(column.key, 1)}><Icon name="chevron" /></button>
          </div>
        </div>
      {/each}
      {#if !shown.length}<p class="property-empty">No matching columns.</p>{/if}
    </div>
    <footer><span>ID stays visible.</span><button onclick={onreset}>Reset columns</button></footer>
  {/snippet}
</Popover>

<style>
  header { display: flex; align-items: center; justify-content: space-between; flex: none; min-height: 40px; padding-inline: 12px 4px; border-bottom: 1px solid var(--color-border); }
  .column-search { padding: 8px 12px; }
  .column-list { overflow: auto; overscroll-behavior: contain; padding: 0 12px 8px; }
  .column-captions, .column-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px calc(2 * var(--control-height)); align-items: center; gap: 8px; }
  .column-captions { min-height: 28px; color: var(--color-text-3); font: var(--type-caption); }
  .column-captions span:last-child { text-align: center; }
  .column-row { min-height: 52px; border-top: 1px solid var(--color-divider); }
  .column-row:hover, .column-row:focus-within { background: var(--color-row-hover); }
  .column-name { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; cursor: pointer; }
  .column-name > span { min-width: 0; overflow-wrap: anywhere; }
  .column-name small { display: block; color: var(--color-text-3); font: var(--type-caption); }
  .column-width { gap: 4px; }
  .column-width input { appearance: textfield; }
  .column-width input::-webkit-inner-spin-button { appearance: none; }
  .column-order { display: flex; }
  .column-order :global(svg) { transform: rotate(-90deg); }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; padding: 6px 8px 6px 12px; border-top: 1px solid var(--color-border); background: var(--color-surface-2); }
  footer > span { color: var(--color-text-3); font: var(--type-caption); }
</style>
