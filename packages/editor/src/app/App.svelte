<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { openMenu as menuAt, shortcutKey } from './commands.js';
  import { views, viewLabels as labels, Workspace, type ElementViewName } from './workspace.svelte.js';
  import Lazy from '../ui/Lazy.svelte';
  import CaseIssues from './CaseIssues.svelte';
  import CaseDetails from './CaseDetails.svelte';
  import TableActions from '../table/TableActions.svelte';
  import TableView from '../table/TableView.svelte';
  import Search from './Search.svelte';
  import ElementDialog from '../elements/ElementDialog.svelte';
  import Notice from '../ui/Notice.svelte';
  import { errorMessage } from '../ui/errors.js';
  import type NetworkView from '../rendering/NetworkView.svelte';
  import ProjectionControls from '../rendering/ProjectionControls.svelte';
  import Icon from '../ui/Icon.svelte';
  import Menu from '../ui/Menu.svelte';
  import type { MenuItem } from '../ui/menu.js';
  import Toasts from '../ui/Toasts.svelte';
  import { clearNotice, notify } from '../ui/toasts.svelte.js';
  import Welcome from './Welcome.svelte';
  import AppShell from '../ui/AppShell.svelte';
  import leaf from '../assets/leaf.svg';
  import { createPreferences } from '../preferences/state.svelte.js';
  import type { Simulation } from '../simulation/simulation.svelte.js';
  import SolverActions from '../simulation/SolverActions.svelte';
  import SolverView from '../simulation/SolverView.svelte';

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
  const workspace = new Workspace({ get simulation() { return simulation; }, focusTable: () => table?.focus(), focusSolver: () => solver?.focus(), focusWelcome: () => welcome?.focus(), solverInvalid: () => solver?.controls().invalid ?? false });
  const { caseSession, dialogs: stack, open, openPreferences, openExport, lookup, runStudy, choose, chooseOnCanvas, openElement, changeView,
    closeCase, openFile, download, downloadCaseFile } = workspace;
  const { showing, close, pending } = stack;
  const openMenu = (ref: Parameters<typeof menuAt>[1], at: { x: number; y: number }, from: ElementViewName, local?: MenuItem[]) => menuAt(workspace, ref, at, from, local);
  const run = $derived(simulation.run);
  $effect(() => { if (run) untrack(() => { resultsCollapsed = false; }); });
  const editor = $derived(workspace.editor);
  const dialogs = $derived(stack.shown);
  const menu = $derived(workspace.menu);
  const view = $derived(workspace.view);
  const selected = $derived(workspace.selected);
  const hovered = $derived(workspace.hovered);
  const notice = $derived(workspace.notice);
  const session = $derived(workspace.session);
  const entries = $derived(workspace.entries);
  const issues = $derived(workspace.issues);
  const geographic = $derived(workspace.geographic);
  const changed = $derived(workspace.changed);
  const caseOpen = $derived(caseSession.opened);
  const busy = $derived(caseSession.busy);
  // The results dock where they were put, at the side only while a view keeps room beside them.
  const side = $derived(preferences.value.resultsDock === 'right' && areaWidth >= sideDockMin ? 'right' : 'bottom');
  const maxDockWidth = $derived(Math.max(320, areaWidth - 240));
  // Forms and tables keep at least half the phone workspace while results are open.
  const maxDockHeight = $derived(Math.max(0, areaWidth < sideDockMin && view !== 'network'
    ? areaHeight * .5 : areaHeight - Math.min(96, areaHeight * .25)));
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
    if (current && !message) { untrack(() => clearNotice('simulation')); return; }
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
      <Menu label="GridKit menu" groups={[[
        { label: 'Case information', icon: 'info', run: () => open({ kind: 'case' }) },
        { label: 'Download case', icon: 'download', run: download },
        { label: 'Return home', icon: 'open', run: closeCase },
      ]]}>
        {#snippet trigger(popup, expanded)}
          <button type="button" class="home-button" aria-label="GridKit menu" title="GridKit menu" aria-haspopup="menu" aria-expanded={expanded} popovertarget={popup} disabled={busy}>
            <img src={leaf} alt="" width="20" height="20" />GridKit
          </button>
        {/snippet}
      </Menu>
    </div>
    <div class="header-projection" role="group" aria-label="Network controls" hidden={view !== 'network'}>
      {#if networkView}<ProjectionControls {...networkView.controls()} onproject={networkView.project} />{/if}
    </div>
    {#if view === 'table'}
      <div class="header-table">
        {#if table}<TableActions {table} />{/if}
        <div class="header-search">
          {#key session}<Search bind:query={workspace.query} matchCount={tableMatches} onnavigate={() => table?.focus()} />{/key}
        </div>
      </div>
    {:else if view === 'solver' && solver}
      <div class="header-solver" role="group" aria-label="Simulation controls"><SolverActions {solver} /></div>
    {/if}
{/snippet}
{#snippet appNavigation()}
    {#each views as item (item)}
      <button aria-label={labels[item]} title={labels[item]} aria-current={view === item ? 'page' : undefined}
        disabled={busy} onclick={() => changeView(item)}>
        <Icon name={item} /><span>{labels[item]}</span>
      </button>
    {/each}
    <button class="export-trigger" aria-label="Export" title="Export" aria-haspopup="dialog" aria-expanded={showing('export')}
      disabled={busy || !exportable} onclick={() => networkView?.exportShown()}><Icon name="export" /><span class="mobile-action-label">Export</span></button>
    <button class="preferences-trigger" aria-label="Settings" title="Settings" aria-haspopup="dialog"
      aria-expanded={showing('preferences')} onclick={() => openPreferences()}><Icon name="settings" /><span class="mobile-action-label">Settings</span></button>
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
              <Lazy load={() => import('../rendering/NetworkView.svelte')}>
                {#snippet children({ default: NetworkView })}<NetworkView bind:this={networkView} bind:exportable document={editor.document} mappings={caseSession.mappings} {geographic} active={view === 'network'} {selected} {hovered} onhover={ref => workspace.hover('network', ref)} {preferences}
                run={run?.caseVersion === editor.caseVersion ? run : null} {dock} onscale={next => { colorScale = next; }}
                onselect={chooseOnCanvas} onopen={openElement} onmenu={(ref, at, local) => openMenu(ref, at, 'network', local)}
                onexport={openExport} />{/snippet}
              </Lazy>
              {#snippet failed(error)}
                <Notice message={'Rendering is unavailable. ' + errorMessage(error)} />
              {/snippet}
            </svelte:boundary>
          </div>
          <div class="view-pane content-pane" hidden={view !== 'table'}>
            <TableView bind:this={table} {entries} active={view === 'table'} fields={target => editor.document.fields(target)} selected={lookup(selected) ?? null} {preferences} query={workspace.query} onresults={total => { tableMatches = total; }} onselect={choose} onopen={openElement}
              onmenu={(entry, at) => openMenu(entry, at, 'table')} />
          </div>
          <div class="view-pane content-pane" hidden={view !== 'solver'}>
            {#if workspace.solverVisited}
            <SolverView bind:this={solver} document={editor.document} bind:study={() => caseSession.study, next => caseSession.updateStudy(next)}
              canRun={simulation.available && !simulation.busy} busy={simulation.busy}
              unavailableReason={simulation.solver.error || (simulation.solver.status === 'connecting' ? 'Connecting to solver…' : '')}
              connectionError={simulation.solver.error}
              onretry={simulation.solver.status === 'unreachable' && !simulation.solver.pending ? () => { void simulation.solver.connect(); } : undefined}
              onrun={() => { runStudy(); }} onstop={() => simulation.run?.cancel()} />
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
          <Lazy load={() => import('../simulation/ResultsDock.svelte')}>
            {#snippet children({ default: ResultsDock })}<ResultsDock {run} {preferences} {side} {selected} {hovered} onselect={chooseOnCanvas} onhover={ref => workspace.hover('plot', ref)} bind:collapsed={resultsCollapsed} scale={colorScale}
            onclose={() => { simulation.close(); void workspace.focusView(); }}
            ondock={areaWidth >= sideDockMin ? next => preferences.set('resultsDock', next) : undefined} />{/snippet}
          </Lazy>
        </div>
      {/if}
      <Toasts />
    </div>
</AppShell>
{#each dialogs as dialog (dialog)}
  {@const onpending = (value: boolean) => { if (value) pending.add(dialog); else pending.delete(dialog); }}
  {#if dialog.kind === 'preferences'}
    <Lazy load={() => import('./PreferencesDialog.svelte')}>
      {#snippet children({ default: PreferencesDialog })}<PreferencesDialog {preferences} {caseOpen} document={editor.document} {geographic}
      mappings={caseSession.mappings} onmappings={value => caseSession.updateMappings(value)}
      initialPage={dialog.page} simulation={!!run?.data} measure={run?.networkMeasure} band={run?.band}
      {onpending} onclose={() => close('preferences')} />{/snippet}
    </Lazy>
  {:else if dialog.kind === 'case' && caseOpen}
    <CaseDetails value={editor.info} disabled={busy} onclose={() => close('case')} ondownload={download} />
  {:else if dialog.kind === 'element'}
    <ElementDialog document={editor.document} ref={dialog.ref} onclose={() => close('element')} />
  {:else if dialog.kind === 'export'}
    <Lazy load={() => import('../rendering/ExportDialog.svelte')}>
      {#snippet children({ default: ExportDialog })}<ExportDialog request={dialog.request} name={dialog.name} {preferences} onclose={() => close('export')} />{/snippet}
    </Lazy>
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
  .results-layer { position: absolute; inset-inline: 0; bottom: 0; z-index: 2; }
  .results-layer.right { top: 0; left: auto; }
  .content-pane { width: calc(100% - var(--dock-width, 0px)); height: calc(100% - var(--dock-height, 0px)); }
</style>
