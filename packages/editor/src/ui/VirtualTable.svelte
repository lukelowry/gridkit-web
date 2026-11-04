<script lang="ts">
  import { getAbortSignal, untrack, type Snippet } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import type { HTMLAttributes } from 'svelte/elements';
  import { errorMessage } from './errors.js';
  import Icon from './Icon.svelte';
  import { displayCell } from './table.js';

  import type { TableColumn, TableSort, TableSource, TableWindow } from './table.js';

  let {
    source,
    identity,
    columns,
    label,
    query,
    sort = $bindable(null),
    selected = $bindable(null),
    scrollTop = $bindable(0),
    emptyText = 'No rows match.',
    columnHeaders = {},
    actions,
    onresults,
    resetKey = '',
    retainSelection = true,
    onopen,
    onmenu,
    class: className,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    readonly source: TableSource;
    readonly identity: { readonly label: string; readonly width: number };
    readonly columns: readonly TableColumn[];
    readonly label: string;
    readonly query: string;
    sort?: TableSort | null;
    selected?: string | null;
    scrollTop?: number;
    readonly emptyText?: string;
    columnHeaders?: Readonly<Record<string, Snippet>>;
    actions?: Snippet;
    onresults?: (total: number) => void;
    resetKey?: string;
    retainSelection?: boolean;
    onopen?: (key: string) => void;
    /** Asks for row `key`'s menu at a viewport point; without it, rows keep the browser's menu. */
    onmenu?: (key: string, at: { readonly x: number; readonly y: number }) => void;
  } = $props();

  const id = $props.id();
  let grid = $state<HTMLElement>();
  let probe = $state<HTMLElement>();
  let header = $state<HTMLElement>();
  let actionBar = $state<HTMLElement>();
  let actionWidth = $state(0);
  let view = $state.raw<TableWindow & { readonly offset: number }>({ rows: [], total: 0, offset: 0 });
  let loading = $state(false);
  let failure = $state<string | null>(null);
  let rowHeight = $state(32);
  let headerHeight = $state(36);
  const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
    count: 0, getScrollElement: () => null, estimateSize: () => 32, overscan: 6,
  });
  const items = $derived($virtualizer.getVirtualItems());
  const first = $derived(items[0]?.index ?? 0);
  const count = $derived(items.length || 1);
  const total = $derived(view.total);
  $effect(() => { onresults?.(total); });

  let cursor = $state(0);
  const active = $derived(Math.min(cursor, view.total - 1));
  const heads: readonly TableColumn[] = $derived([{ key: 'id', ...identity }, ...columns]);
  const template = $derived(`${heads.map(head => `${head.width}px`).join(' ')} minmax(${actionWidth}px, 1fr)`);
  const width = $derived(heads.reduce((sum, head) => sum + head.width, actionWidth));
  export function focus() { grid?.focus({ preventScroll: true }); }

  const rowId = (position: number): string => `${id}-row-${position}`;
  $effect(() => {
    if (!probe || !header) return;
    const row = probe, head = header, bar = actionBar;
    const measure = () => {
      // CSS remains the authority for density and touch-target sizes.
      if (row.offsetHeight) rowHeight = row.offsetHeight;
      if (head.offsetHeight) headerHeight = head.offsetHeight;
      actionWidth = bar && getComputedStyle(bar).position === 'absolute' ? bar.offsetWidth : 0;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(head);
    if (bar) observer.observe(bar);
    return () => observer.disconnect();
  });
  $effect(() => {
    const element = grid, size = rowHeight, padding = headerHeight, rows = total;
    untrack(() => {
      const resized = $virtualizer.options.estimateSize(0) !== size;
      $virtualizer.setOptions({
        count: rows, getScrollElement: () => element ?? null, estimateSize: () => size,
        paddingStart: padding, scrollPaddingStart: padding,
      });
      if (resized) $virtualizer.measure();
    });
  });
  $effect(() => {
    const signal = getAbortSignal();
    const offset = first;
    let answer: TableWindow | Promise<TableWindow>;
    try {
      answer = source.window(query, sort, offset, count, signal);
    } catch (error) {
      failure = errorMessage(error);
      loading = false;
      return;
    }
    if (!(answer instanceof Promise)) {
      view = { ...answer, offset };
      failure = null;
      loading = false;
      return;
    }
    loading = true;
    answer.then(
      (rows) => {
        if (signal.aborted) return;
        view = { ...rows, offset };
        failure = null;
        loading = false;
      },
      (error: unknown) => {
        if (signal.aborted) return;
        failure = errorMessage(error);
        loading = false;
      },
    );
  });
  let asked: { query: string; sort: TableSort | null; resetKey: string } | undefined;
  $effect(() => {
    const next = { query, sort, resetKey };
    const changed = asked !== undefined && (asked.query !== next.query || asked.sort !== next.sort || asked.resetKey !== next.resetKey);
    asked = next;
    if (!changed) return;
    untrack(() => {
      cursor = 0;
      $virtualizer.scrollToOffset(0);
      scrollTop = 0;
    });
  });
  let restored = false;
  $effect(() => {
    if (restored || !grid || view.total === 0) return;
    restored = true;
    untrack(() => $virtualizer.scrollToOffset(scrollTop));
  });


  $effect(() => {
    const key = selected;
    const lookup = source;
    const retain = retainSelection;
    const signal = getAbortSignal();
    if (key === null || !lookup.locate) return;
    void Promise.resolve(lookup.locate(key, query, sort, signal)).then(position => {
      if (signal.aborted || selected !== key) return;
      if (position !== null) untrack(() => activate(position));
      else if (!retain) selected = null;
    }, () => {});
  });

  function activate(position: number): void {
    if (view.total === 0) return;
    cursor = Math.min(Math.max(position, 0), view.total - 1);
    $virtualizer.scrollToIndex(cursor, { align: 'auto' });
  }

  function selectActive(open: boolean): void {
    if (view.total === 0) return;
    const asked = source, askedQuery = query, askedSort = sort;
    let answer: TableWindow | Promise<TableWindow>;
    try {
      answer = source.window(query, sort, active, 1);
    } catch (error) {
      failure = errorMessage(error);
      return;
    }
    Promise.resolve(answer).then(
      (rows) => {
        if (rows.rows[0] && source === asked && query === askedQuery && sort === askedSort) {
          selected = rows.rows[0].key;
          if (open) onopen?.(selected);
        }
      },
      (error: unknown) => {
        if (source === asked) failure = errorMessage(error);
      },
    );
  }

  function rowAt(target: EventTarget | null): { readonly key: string; readonly position: number } | undefined {
    const row = target instanceof Element ? target.closest<HTMLElement>('[role="row"][data-key]') : null;
    if (!row) return undefined;
    return { key: row.dataset['key']!, position: Number(row.getAttribute('aria-rowindex')) - 2 };
  }

  function pressed(event: MouseEvent): void {
    const row = rowAt(event.target);
    if (!row) return;
    focus();
    cursor = row.position;
    selected = row.key;
  }

  // A row's menu opens where it was pressed; the menu key opens the active row's below its name.
  function menu(event: MouseEvent): void {
    const row = rowAt(event.target);
    if (!row || !onmenu) return;
    event.preventDefault();
    focus();
    cursor = row.position;
    onmenu(row.key, { x: event.clientX, y: event.clientY });
  }
  /** False while the active row is scrolled out of the window. */
  function menuForActive(): boolean {
    const row = grid?.querySelector<HTMLElement>(`[id="${rowId(active)}"]`), name = row?.querySelector('[data-part="identity"]')?.getBoundingClientRect();
    if (row && name) onmenu?.(row.dataset['key']!, { x: name.left + 12, y: name.bottom });
    return !!name;
  }
  // A menu asked for a row scrolled away waits for the window that brings the row back.
  let menuPending = false;
  $effect(() => {
    void view;
    if (!menuPending) return;
    menuPending = false;
    untrack(menuForActive);
  });

  function keydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (onmenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      if (!menuForActive() && view.total) { menuPending = true; activate(active); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectActive(event.key === 'Enter');
      return;
    }
    const page = Math.max(1, Math.floor(((grid?.clientHeight ?? 0) - headerHeight) / rowHeight));
    const targets: Record<string, number> = {
      ArrowDown: active + 1, ArrowUp: active - 1,
      PageDown: active + page, PageUp: active - page,
      Home: 0, End: view.total - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    activate(target);
  }

  function sortBy(column: number | null): void {
    if (sort?.column !== column) sort = { column, dir: 'asc' };
    else sort = sort.dir === 'asc' ? { column, dir: 'desc' } : null;
  }

  function ariaSort(column: number | null): 'ascending' | 'descending' | 'none' {
    if (sort?.column !== column) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  }
</script>

<div class="vt-shell">
  <div
    {...rest}
    class={['vt', className]}
    role="grid"
    tabindex="0"
    aria-label={label}
    aria-rowcount={view.total + 1}
    aria-colcount={heads.length}
    aria-busy={loading}
    aria-activedescendant={active >= view.offset && active < view.offset + view.rows.length ? rowId(active) : undefined}
    style:--vt-cols={template}
    bind:this={grid}
    onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
    onkeydown={keydown}
  >
    <div class="vt__measure" aria-hidden="true" bind:this={probe}></div>
    <div class="vt__surface" data-part="surface" style:height={`${$virtualizer.getTotalSize()}px`} style:inline-size={`${width}px`}>
      <div class="vt__header" role="row" bind:this={header}>
        {#each heads as head, index (head.key)}
          {@const column = index === 0 ? null : index - 1}
          <div class="vt__head" class:vt__numeric={head.numeric} role="columnheader" aria-sort={ariaSort(column)}
            aria-label={head.group ? `${head.group} ${head.label}` : undefined} title={head.group ? `${head.group}: ${head.label}` : undefined} data-column={head.key}>
            {#if columnHeaders[head.key]}
              {@render columnHeaders[head.key]!()}
            {:else}
              <button type="button" class="vt__sort" aria-label={`Sort by ${head.group ? `${head.group} ` : ''}${head.label}`} onclick={() => sortBy(column)}>
                <span class="vt__head-label">{head.label}</span>
                {#if sort !== null && sort.column === column}
                  <Icon name={sort.dir === 'asc' ? 'up' : 'chevron'} />
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div class="vt__body" role="rowgroup" onclick={pressed} oncontextmenu={menu} ondblclick={event => {
        const row = rowAt(event.target);
        if (row) onopen?.(row.key);
      }}>
        {#each view.rows as row, offset (row.key)}
          {@const position = view.offset + offset}
          <div
            id={rowId(position)}
            class={['vt__row', row.key === selected && 'vt__row--selected', position === active && 'vt__row--active']}
            role="row"
            aria-rowindex={position + 2}
            aria-selected={row.key === selected}
            data-key={row.key}
            style:--at={position}
          >
            <div class="vt__cell" role="gridcell" data-part="identity">
              <span class="vt__identity" title={row.label}>{row.label}</span>
            </div>
            {#each row.cells as cell, at (at)}
              <div class="vt__cell" class:vt__numeric={columns[at]?.numeric} role="gridcell" title={cell}><span>{displayCell(cell, columns[at]?.precision)}</span></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    {#if failure !== null}
      <p class="vt__empty" role="alert">{failure}</p>
    {:else if view.total === 0}
      <p class="vt__empty" role="status" data-part="empty">{emptyText}</p>
    {/if}
  </div>
  {#if actions}<div class="vt__actions" bind:this={actionBar}>{@render actions()}</div>{/if}
</div>

<style>
  .vt-shell { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; container-type: inline-size; --vt-head-h: 36px; }
  .vt { --vt-row-h: var(--table-row-height, 32px); position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; background: var(--color-surface-1); color: var(--color-text-1); font: var(--type-compact); }
  .vt__measure { position: absolute; height: var(--vt-row-h); visibility: hidden; pointer-events: none; }
  .vt__empty { position: sticky; left: 0; width: 100%; margin: 0; padding: 32px 16px; color: var(--color-text-3); text-align: center; }
  .vt__surface { position: relative; min-width: 100%; }
  .vt__header { position: sticky; top: 0; z-index: 1; display: grid; grid-template-columns: var(--vt-cols); height: var(--vt-head-h); border-bottom: 1px solid var(--color-border); background: var(--color-surface-2); }
  .vt__head { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 4px 12px; }
  .vt__sort { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 28px; padding: 0; border: 0; border-radius: var(--radius-sm); color: var(--color-text-2); text-align: left; }
  .vt__sort :global(svg) { flex: none; width: 12px; height: 12px; color: var(--color-primary-text); }
  .vt__head-label, .vt__cell > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .vt__body { position: absolute; inset: var(--vt-head-h) 0 0; }
  .vt__row { position: absolute; inset-inline: 0; display: grid; grid-template-columns: var(--vt-cols); align-items: stretch; height: var(--vt-row-h); border-bottom: 1px solid var(--color-divider); transform: translateY(calc(var(--at) * var(--vt-row-h))); cursor: pointer; contain: size style; background: var(--color-surface-1); }
  .vt__row:hover { background: var(--color-row-hover); }
  .vt__row--selected { background: var(--color-selected); }
  .vt:focus-visible .vt__row--active { outline: var(--focus-ring); outline-offset: calc(-1 * var(--focus-width)); }
  .vt__cell { display: flex; align-items: center; min-width: 0; padding-inline: 12px; overflow: hidden; font-variant-numeric: tabular-nums; }
  .vt__numeric { text-align: right; }
  .vt__numeric.vt__cell, .vt__numeric .vt__sort { justify-content: flex-end; }
  /* Row identity remains visible when inspecting fields beyond the viewport. */
  .vt__head:first-child, .vt__cell[data-part="identity"] { position: sticky; left: 0; z-index: 1; background: inherit; border-right: 1px solid var(--color-divider); }
  .vt__head:first-child { background: var(--color-surface-2); }
  .vt__identity { width: 100%; color: var(--color-primary-text); font-weight: 500; }
  .vt__actions { position: absolute; top: 0; right: 0; z-index: 2; display: flex; align-items: center; gap: var(--spacing-2xs); width: max-content; min-width: 44px; padding-inline: 5px; height: var(--vt-head-h); border-left: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); background: var(--color-surface-2); }
  @container (max-width: 640px) {
    .vt__actions { position: static; flex: none; justify-content: flex-start; width: auto; border-left: 0; border-top: 1px solid var(--color-border); border-bottom: 0; overflow-x: auto; }
    .vt__actions > :global(*) { flex-shrink: 0; }
  }
  @media (max-width: 767px), (any-pointer: coarse) {
    .vt-shell { --vt-head-h: 52px; }
    .vt { --vt-row-h: var(--spacing-touch-h); }
    .vt__sort { min-height: 32px; }
  }
  @media (forced-colors: active) { .vt__row--selected { outline: 1px solid Highlight; background: Highlight; color: HighlightText; } .vt__row--selected .vt__identity { color: HighlightText; } }
</style>
