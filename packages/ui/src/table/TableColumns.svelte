<script lang="ts">
  import type { TableColumn } from '../ui/table.js';
  import Icon from '../ui/Icon.svelte';
  import PickerPanel from '../ui/PickerPanel.svelte';
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
    <PickerPanel label="Find columns" search={columns.length > 6} bind:query empty={!shown.length} emptyText="No matching columns.">
      {#snippet header()}<h2>Columns</h2><button class="c-icon-btn" aria-label="Close columns" title="Close columns" onclick={close}><Icon name="close" /></button>{/snippet}
      <div class="column-captions" aria-hidden="true"><span>Column</span><span>Width</span><span>Order</span></div>
      {#each shown as column (column.key)}
        {@const index = columns.findIndex(item => item.key === column.key)}
        <div class="column-row">
          <label class="column-name"><input type="checkbox" checked={column.visible}
            aria-label={`Show ${column.group ? `${column.group} ` : ''}${column.label}`}
            onchange={event => onupdate(column.key, { visible: event.currentTarget.checked })} />
            <span title={column.group ? `${column.group}: ${column.label}` : column.label}>{column.label}</span>
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
      {#snippet footer()}<span>ID stays visible.</span><button onclick={onreset}>Reset columns</button>{/snippet}
    </PickerPanel>
  {/snippet}
</Popover>

<style>
  .column-captions, .column-row { display: grid; grid-template-columns: minmax(0, 1fr) 68px calc(2 * var(--control-height)); align-items: center; gap: 4px; padding-inline: 4px; }
  .column-captions { min-height: 28px; color: var(--color-text-3); font: var(--type-caption); }
  .column-captions span:last-child { text-align: center; }
  .column-row { min-height: 52px; border-top: 1px solid var(--color-divider); }
  .column-row:hover, .column-row:focus-within { background: var(--color-row-hover); }
  .column-name { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; cursor: pointer; }
  .column-name > span { min-width: 0; overflow-wrap: anywhere; }
  .column-width { gap: 4px; }
  .column-width input { appearance: textfield; }
  .column-width input::-webkit-inner-spin-button { appearance: none; }
  .column-order { display: flex; }
  .column-order :global(svg) { transform: rotate(-90deg); }
</style>
