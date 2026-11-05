<script lang="ts">
  import type SolverView from './SolverView.svelte';
  import Icon from '../ui/Icon.svelte';
  import Menu from '../ui/Menu.svelte';
  let { solver }: { solver: SolverView } = $props();
  const state = $derived(solver.controls());
  const description = $props.id();
</script>
<div class="solver-actions">
  <button type="button" class="primary run" class:running={state.busy} aria-label={state.busy ? 'Stop simulation' : 'Run simulation'}
    disabled={!state.busy && (!state.canRun || state.invalid)} aria-describedby={state.invalid || state.availability ? description : undefined}
    onclick={() => { if (state.busy) state.stop(); else state.run(); }}>
    <Icon name={state.busy ? 'stop' : 'play'} /><span class="run-label"><span class:inactive={state.busy}>Run</span><span class:inactive={!state.busy}>Stop</span></span>
  </button>
  <span class="sr-only" id={description} role="status">{state.invalid ? 'Check settings in Solver options.' : state.availability}</span>
  <Menu label="Solver options" align="end" groups={[
    [{ label: 'Check settings', icon: 'warning', disabled: !state.invalid, run: state.review },
      { label: 'Retry connection', icon: 'undo', disabled: !state.onretry, run: () => state.onretry?.() }],
    [{ label: 'Import solver settings', icon: 'open', run: state.importSettings },
      { label: 'Download solver settings', icon: 'download', disabled: state.invalid, run: state.download }],
    [{ label: 'Reset solver settings', icon: 'undo', run: state.reset }],
  ]}>
    {#snippet trigger(popup, expanded)}<button type="button" class="c-icon-btn" aria-label="Solver options" title="Solver options" aria-haspopup="menu" aria-expanded={expanded} popovertarget={popup}><Icon name="more" /></button>{/snippet}
  </Menu>
</div>
<style>
  .solver-actions, .run { display: flex; align-items: center; gap: 4px; }
  .solver-actions { justify-content: flex-end; flex-wrap: nowrap; }
  .run-label { display: grid; }
  .run-label > span { grid-area: 1 / 1; }
  .inactive { visibility: hidden; }
  .running { background: var(--color-error-surface); border-color: var(--color-error); color: var(--color-error); }
  @media (max-width: 767px) { .run { padding-inline: 8px; } }
</style>
