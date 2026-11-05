<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import leaf from '../assets/leaf.svg';
  import type { ConnectionStatus } from '../services/connection.svelte.js';

  let { busy, library, onopen, onlibrary }: {
    busy: boolean;
    library: ConnectionStatus;
    onopen: () => void;
    onlibrary: () => void;
  } = $props();
  let libraryButton = $state<HTMLButtonElement>();
  let openButton = $state<HTMLButtonElement>();
  const hasLibrary = $derived(library !== 'absent');

  export function focus() {
    (libraryButton && !libraryButton.disabled ? libraryButton : openButton)?.focus();
  }
</script>

<section class="welcome c-scroll-region" aria-label="Welcome">
  <div class="welcome__start">
    <div class="welcome__identity">
      <img class="welcome__leaf" src={leaf} alt="" width="40" height="40" />
      <h1>GridKit</h1>
    </div>
    <div class="welcome__commands" role="group" aria-label="Get started">
      {#if hasLibrary}
        <button class="c-action welcome__command primary" bind:this={libraryButton} disabled={busy || library === 'connecting'}
          aria-busy={library === 'connecting'} aria-haspopup="dialog" onclick={onlibrary}><Icon name="library" /><span>Open from library…</span></button>
      {/if}
      <button class={['c-action', 'welcome__command', { primary: !hasLibrary }]} bind:this={openButton} disabled={busy} onclick={onopen}>
        <Icon name="open" /><span>Open file…</span>
      </button>
    </div>
  </div>
</section>

<style>
  .welcome { display: flex; height: 100%; padding: calc(2 * var(--spacing-lg)) calc(2 * var(--spacing-md)); }
  /* Auto margins center spare space and yield when the content needs to scroll. */
  .welcome__start { width: 18rem; max-width: 100%; min-width: 0; flex: none; margin: auto; }
  .welcome__identity { display: flex; align-items: center; gap: var(--spacing-md); margin: 0 0 calc(2 * var(--spacing-md)) var(--spacing-lg); }
  .welcome__leaf { flex: none; width: 40px; height: 40px; }
  :global(:root[data-theme="dark"]) .welcome__leaf { filter: brightness(0) invert(0.92); }
  @media (forced-colors: active) { .welcome__leaf { forced-color-adjust: none; } }
  h1 { margin: 0; font: var(--type-title); font-size: 1.25rem; color: var(--color-text-1); }
  .welcome__commands { display: grid; gap: var(--spacing-2xs); }
  .welcome__command { gap: var(--spacing-md); min-height: max(40px, var(--control-height)); padding: var(--spacing-sm) var(--spacing-lg); font: var(--type-body); }
  .welcome__command:not(.primary) { color: var(--color-text-2); }
  @media (max-width: 767px) {
    .welcome { padding-inline: var(--spacing-lg); }
    .welcome__start { width: 100%; max-width: 28rem; margin-block: 0 auto; }
  }
  @media (max-height: 480px) { .welcome { padding-block: var(--spacing-lg); } }
</style>
