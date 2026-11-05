<script lang="ts">
  import type { CaseDocument } from '@gridkit/library';
  import type { Study } from '@gridkit/library/gridkit';
  import Lazy from '../ui/Lazy.svelte';
  import { watchNotice } from '../ui/toasts.svelte.js';
  import type SolverSettings from './SolverSettings.svelte';
  let { document, study = $bindable(), canRun, busy, unavailableReason, connectionError, onretry, onrun, onstop }: {
    document: CaseDocument; study: Study; canRun: boolean; busy: boolean; unavailableReason: string; connectionError: string;
    onretry?: (() => void) | undefined; onrun: () => void; onstop: () => void;
  } = $props();
  let invalid = $state(false), form = $state<SolverSettings>(), region: HTMLElement;
  watchNotice(() => connectionError, () => ({ action: { label: 'Retry connection', run: () => onretry?.() } }));
  export function focus() { region?.focus({ preventScroll: true }); }
  export function controls() {
    return { invalid, canRun: canRun && !!form, busy, onretry,
      availability: !canRun && !busy ? unavailableReason || 'Simulation unavailable.' : '',
      review: () => form?.focusIssue(), run: onrun, stop: onstop,
      importSettings: () => form?.importSettings(), download: () => form?.download(),
      reset: () => { form?.reset(); focus(); } };
  }
</script>
<section class="solver-view" aria-label="Solver" tabindex="-1" bind:this={region}>
  <div class="solver-body property-list c-scroll-region"><div class="solver-form">
    <Lazy load={() => import('./SolverSettings.svelte')}>
      {#snippet children({ default: SolverSettings })}<SolverSettings bind:this={form} {document} bind:value={study} oninvalid={next => { invalid = next; }} />{/snippet}
    </Lazy>
  </div></div>
</section>
<style>
  .solver-view { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
  .solver-body { display: flex; flex-direction: column; flex: 1; padding-top: 8px; }
  .solver-form { display: flex; flex-direction: column; flex: 1; }
</style>
