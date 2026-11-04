<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { openMenu as menuAt, shortcutKey } from './commands.js';
  import { views, viewLabels as labels, Workspace, type ElementViewName } from './workspace.svelte.js';
  import CaseIssues from './CaseIssues.svelte';
  import type { Entry } from '../domain/entries.js';
  import CaseDetails from './CaseDetails.svelte';
  import TableView from '../table/TableView.svelte';
  import Search from './Search.svelte';
  import ElementDialog from '../elements/ElementDialog.svelte';
  import DeleteElementDialog from '../elements/DeleteElementDialog.svelte';
  import ModelPicker from '../elements/ModelPicker.svelte';
  import { errorMessage } from '../ui/errors.js';
  import { ariaShortcut, shortcutTitle } from './shortcuts.js';
  import NetworkView from '../rendering/NetworkView.svelte';
  import ExportDialog from '../rendering/ExportDialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import Menu, { type MenuItem } from '../ui/Menu.svelte';
  import Toasts from '../ui/Toasts.svelte';
  import { notify } from '../ui/toasts.svelte.js';
  import PreferencesDialog from './PreferencesDialog.svelte';
  import Welcome from './Welcome.svelte';
  import AppShell from '../ui/AppShell.svelte';
  import { createPreferences } from '../preferences/state.svelte.js';
  import type { Simulation } from '../simulation/simulation.svelte.js';
  import SolverView from '../simulation/SolverView.svelte';
  import ResultsDock from '../simulation/ResultsDock.svelte';
  import ResizeHandle from '../ui/ResizeHandle.svelte';
  import type { ColorScale } from '../ui/ramps.js';
  import { undocked, type Dock } from '../rendering/network-host.svelte.js';
  import LibraryDialog from '../library/LibraryDialog.svelte';
  import type { Library } from '@gridkit/library';
  import type { Connection } from '../services/connection.svelte.js';

  let { simulation, library }: { simulation: Simulation; library: Connection<Library> } = $props();
  /** The narrowest workspace with room for the results at its side: their least width, and a view's beside them. */
  const sideDockMin = 720;
  let picker: HTMLInputElement;
  let welcome = $state<Welcome>();
  let table = $state<TableView>();
  let solver = $state<SolverView>();
  let tableMatches = $state(0);
  let networkView = $state<NetworkView>();
  /** Whether the view shown has drawn something the rail's Export can export. */
  let exportable = $state(false);
  let areaWidth = $state(0), areaHeight = $state(0), dockWidth = $state(0), dockHeight = $state(0);
  let resultsWidth = $state<number | null>(null), resultsHeight = $state<number | null>(null);
  let resultsCollapsed = $state(false);
  const resultsId = $props.id();
  let colorScale = $state.raw<ColorScale | null>(null);
  const preferences = createPreferences();
  const workspace = new Workspace({ get simulation() { return simulation; }, focusTable: () => table?.focus(), focusSolver: () => solver?.focus(), focusWelcome: () => welcome?.focus() });
  const { caseSession, dialogs: stack, open, openPreferences, openExport, lookup, runStudy, choose, chooseOnCanvas, openElement, addModel, changeView,
    commitElement, commitMappings, requestDelete, deleteElement, closeCase, openFile, download, downloadCaseFile } = workspace;
  const { showing, close, pending } = stack;
  const openMenu = (ref: Parameters<typeof menuAt>[1], at: { x: number; y: number }, from: ElementViewName, local?: MenuItem[]) => menuAt(workspace, ref, at, from, local);
  const run = $derived(simulation.run);
  $effect(() => { if (run) untrack(() => { resultsCollapsed = false; }); });
  const editor = $derived(workspace.editor);
  const dialogs = $derived(stack.shown);
  const menu = $derived(workspace.menu);
  const view = $derived(workspace.view);
  const selected = $derived(workspace.selected);
  const notice = $derived(workspace.notice);
  const session = $derived(workspace.session);
  const entries = $derived(workspace.entries);
  const issues = $derived(workspace.issues);
  const geographic = $derived(workspace.geographic);
  const changed = $derived(workspace.changed);
  const interactive = $derived(workspace.interactive);
  const canDelete = $derived(workspace.canDelete);
  const caseOpen = $derived(caseSession.opened);
  const busy = $derived(caseSession.busy);
  // The results dock where they were put, at the side only while a view keeps room beside them.
  const side = $derived(preferences.value.resultsDock === 'right' && areaWidth >= sideDockMin ? 'right' : 'bottom');
  const maxDockWidth = $derived(Math.max(320, areaWidth - 240));
  const maxDockHeight = $derived(Math.max(0, areaHeight - Math.min(96, areaHeight * .25)));
  const minDockHeight = $derived(Math.min(240, maxDockHeight));
  const resultsSize = $derived(Math.round(side === 'right'
    ? Math.min(maxDockWidth, Math.max(320, resultsWidth ?? Math.min(560, areaWidth * .32)))
    : Math.min(maxDockHeight, Math.max(minDockHeight, resultsHeight ?? 400))));
  const dock = $derived<Dock>(!caseOpen || !run ? undocked : side === 'right' ? { right: dockWidth, bottom: 0 } : { right: 0, bottom: dockHeight });
  onDestroy(() => simulation.close());
  // Publish theme tokens before canvas effects read their computed palette.
  $effect.pre(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.motion = preferences.motion;
    document.documentElement.dataset.contrast = preferences.contrast;
  });
  // A failed run offers its log and another try. A run that recorded nothing leaves nothing to show, so its results close.
  $effect(() => {
    const current = run, message = current?.error;
    if (current && message) untrack(() => {
      const log = current.artifacts.find(artifact => artifact.name === 'log'), failed = current.failed;
      notify(message, { key: 'simulation', ...log && 'href' in log && { link: { label: 'Download log', href: log.href, file: log.file } },
        ...failed && { action: { label: 'Run again', run: runStudy } } });
      if (failed && !current.recorded) simulation.close();
    });
  });
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!changed && !simulation.busy) return;
    event.preventDefault();
    event.returnValue = '';
  }
</script>

<svelte:head><title>GridKit</title></svelte:head>
<svelte:window onbeforeunload={beforeUnload} onkeydowncapture={event => shortcutKey(workspace, event)} />
<input hidden type="file" accept=".json,.case.json" aria-label="Open case file" bind:this={picker}
  onchange={event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void openFile(file);
  }} />

{#snippet appHeader()}
    <div class="identity">
      <button type="button" class="home-button" aria-label="GridKit home" title="Return home" aria-haspopup="dialog" aria-expanded={showing('home')}
        disabled={busy} onclick={() => open({ kind: 'home' })}>GridKit</button>
      <button type="button" class="case-name" title={editor.info.header.case_name || 'Untitled'} aria-label={`Case information: ${editor.info.header.case_name || 'Untitled'}`} disabled={busy} aria-haspopup="dialog" aria-expanded={showing('case')}
        onclick={() => open({ kind: 'case' })}>{editor.info.header.case_name || 'Untitled'}</button>
    </div>
    <div class="header-search">
      {#key session}<Search {entries} bind:query={workspace.query} inline={view === 'table'} matchCount={tableMatches} onnavigate={() => table?.focus()} onselect={(item: Entry) => openElement(item)} />{/key}
    </div>
{/snippet}
{#snippet appNavigation()}
    {#each views as item (item)}
      <button aria-label={labels[item]} title={labels[item]} aria-current={view === item ? 'page' : undefined}
        disabled={busy} onclick={() => changeView(item)}>
        <Icon name={item} /><span>{labels[item]}</span>
      </button>
    {/each}
    <button class="export-trigger" aria-label="Export" title="Export" aria-haspopup="dialog" aria-expanded={showing('export')}
      disabled={busy || !exportable} onclick={() => networkView?.exportShown()}><Icon name="export" /></button>
    <button class="preferences-trigger" aria-label="Preferences" title="Preferences" aria-haspopup="dialog"
      aria-expanded={showing('preferences')} onclick={() => openPreferences()}><Icon name="settings" /></button>
{/snippet}
<p class="sr-only" role="status">{busy ? 'Opening case…' : notice}</p>
<AppShell header={caseOpen ? appHeader : undefined} navigation={caseOpen ? appNavigation : undefined} {busy}>
    <div class="view-area" bind:clientWidth={areaWidth} bind:clientHeight={areaHeight} style:--dock-height="{dock.bottom}px" style:--dock-width="{dock.right}px">
      {#if !caseOpen}
        <Welcome bind:this={welcome} {busy} library={library.status} onopen={() => picker.click()}
          onlibrary={() => open({ kind: 'library' })} />
      {:else}
        {#key session}
          <div class="view-pane" hidden={view !== 'network'}>
            <!-- Rendering that fails stays in its views: the Table, dialogs, and files keep working. -->
            <svelte:boundary>
              <NetworkView bind:this={networkView} bind:exportable document={editor.document} mappings={editor.views} {geographic} active={view === 'network'} {selected} {preferences}
                run={run?.caseVersion === editor.caseVersion ? run : null} {dock} onscale={next => { colorScale = next; }}
                onselect={chooseOnCanvas} onopen={openElement} onmenu={(ref, at, local) => openMenu(ref, at, 'network', local)} ontable={() => changeView('table')}
                onexport={openExport} />
              {#snippet failed(error)}
                <div class="view-message" role="alert">
                  <p>Rendering is unavailable.</p>
                  <button onclick={() => changeView('table')}>Open Table</button>
                  <details><summary>Details</summary><p>{errorMessage(error)}</p></details>
                </div>
              {/snippet}
            </svelte:boundary>
          </div>
          <div class="view-pane content-pane" hidden={view !== 'table'}>
            <TableView bind:this={table} {entries} active={view === 'table'} fields={target => editor.document.fields(target)} selected={lookup(selected) ?? null} {preferences} query={workspace.query} {editActions} onresults={total => { tableMatches = total; }} onselect={choose} onopen={openElement}
              onmenu={(entry, at) => openMenu(entry, at, 'table')} {addActions} />
          </div>
          <div class="view-pane content-pane" hidden={view !== 'solver'}>
            {#if workspace.solverVisited}
            <SolverView bind:this={solver} document={editor.document} study={caseSession.study} request={workspace.solverRequest}
              canRun={simulation.available && !simulation.busy} busy={simulation.busy}
              unavailableReason={simulation.solver.error || (simulation.solver.status === 'connecting' ? 'Connecting to solver…' : '')}
              onretry={simulation.solver.status === 'unreachable' && !simulation.solver.pending ? () => { void simulation.solver.connect(); } : undefined}
              onrun={() => { runStudy(); }} onstudy={next => caseSession.updateStudy(next)}
              onstudyexport={next => caseSession.markStudyExported(next)} onpending={next => { workspace.solverPending = next; }} />
            {/if}
          </div>
        {/key}
      {/if}
      <!-- The results lie over the views' foot or side, so a canvas keeps its size and nothing on it moves; the table makes room. -->
      {#if caseOpen && run}
        <div id={resultsId} class={['results-layer', side]} bind:offsetWidth={dockWidth} bind:offsetHeight={dockHeight}
          style:width={side === 'right' ? `${resultsSize}px` : undefined}
          style:height={side === 'bottom' && !resultsCollapsed ? `${resultsSize}px` : undefined}>
          {#if side === 'right' || !resultsCollapsed}
            <ResizeHandle orientation={side === 'right' ? 'vertical' : 'horizontal'} value={resultsSize}
              min={side === 'right' ? 320 : minDockHeight} max={side === 'right' ? maxDockWidth : maxDockHeight}
              controls={resultsId} label={side === 'right' ? 'Resize results width' : 'Resize results height'}
              onresize={size => { if (side === 'right') resultsWidth = size; else resultsHeight = size; }}
              onreset={() => { if (side === 'right') resultsWidth = null; else resultsHeight = null; }} />
          {/if}
          <ResultsDock {run} {preferences} {side} bind:collapsed={resultsCollapsed} scale={colorScale}
            onclose={() => { simulation.close(); void workspace.focusView(); }}
            ondock={areaWidth >= sideDockMin ? next => preferences.set('resultsDock', next) : undefined} />
        </div>
      {/if}
      <Toasts />
    </div>
</AppShell>
{#snippet addActions()}<ModelPicker disabled={!interactive} onchoose={addModel} />{/snippet}
{#snippet editActions()}
  <button class="c-icon-btn" aria-label="Delete selected element" aria-keyshortcuts={ariaShortcut('delete')}
    title={shortcutTitle('Delete selected element', 'delete')} disabled={!canDelete} onclick={() => requestDelete(selected)}><Icon name="trash" /></button>
{/snippet}
{#each dialogs as dialog (dialog)}
  {@const onpending = (value: boolean) => { if (value) pending.add(dialog); else pending.delete(dialog); }}
  {#if dialog.kind === 'preferences'}
    <PreferencesDialog {preferences} {caseOpen} document={editor.document} {geographic} onmappings={commitMappings}
      initialPage={dialog.page} simulation={!!run?.data} measure={run?.networkMeasure} band={run?.band}
      {onpending} onclose={() => close('preferences')} />
  {:else if dialog.kind === 'case' && caseOpen}
    <CaseDetails value={editor.info} disabled={busy} onapply={next => editor.edit('case information', tx => tx.details(next))}
      {onpending} onclose={() => close('case')} ondownload={download} />
  {:else if dialog.kind === 'home'}
    <Dialog label="Return home?" closeLabel="Cancel return home" compact onclose={() => close('home')}>
      <p class="home-message">This closes {editor.info.header.case_name || 'Untitled'}.{changed ? " Changes you haven't downloaded will be lost." : ''}{simulation.busy ? ' Cancellation will be requested for the running study.' : ''}</p>
      {#snippet footer()}
        <button type="button" {@attach element => { queueMicrotask(() => element.focus()); }} onclick={() => close('home')}>Cancel</button>
        <button type="button" class="primary" onclick={closeCase}>Return home</button>
      {/snippet}
    </Dialog>
  {:else if dialog.kind === 'element'}
    <ElementDialog document={editor.document} request={dialog.request} onclose={() => close('element')} {onpending}
      oncommit={commitElement} ondelete={() => requestDelete(dialog.request.ref)} />
  {:else if dialog.kind === 'delete' && lookup(dialog.ref)}
    <DeleteElementDialog entry={lookup(dialog.ref)!} dependents={editor.document.dependents(dialog.ref).map(ref => lookup(ref)!)}
      ondelete={() => deleteElement(dialog.ref, true)} onclose={() => close('delete')} />
  {:else if dialog.kind === 'export'}
    <ExportDialog request={dialog.request} name={dialog.name} {preferences} onclose={() => close('export')} />
  {:else if dialog.kind === 'library'}
    <LibraryDialog {library} onopen={file => { void openFile(file); }} onclose={() => close('library')} />
  {:else if dialog.kind === 'issues'}
    <CaseIssues {issues} {lookup} onclose={() => close('issues')}
      onopen={ref => { close('issues'); if (ref) openElement(ref); else open({ kind: 'case' }); }} ondownload={() => { close('issues'); void downloadCaseFile(); }} />
  {/if}
{/each}

{#if menu}
  {@const shown = menu}
  {#key shown}<Menu label={shown.label} at={shown.at} groups={shown.groups} onclose={() => { if (workspace.menu === shown) workspace.menu = null; }} />{/key}
{/if}

<style>
  .view-area { container: workspace / size; }
  .home-message { margin: 0; padding: var(--spacing-lg); overflow: auto; overflow-wrap: anywhere; font: var(--type-compact); }
  .results-layer { position: absolute; inset-inline: 0; bottom: 0; z-index: 2; }
  .results-layer.right { top: 0; left: auto; }
  .content-pane { width: calc(100% - var(--dock-width, 0px)); height: calc(100% - var(--dock-height, 0px)); }
</style>
