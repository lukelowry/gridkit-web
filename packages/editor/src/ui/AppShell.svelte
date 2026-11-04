<script lang="ts">
  import type { Snippet } from 'svelte';

  let { header, navigation, children, busy = false }: {
    header?: Snippet | undefined;
    navigation?: Snippet | undefined;
    children: Snippet;
    busy?: boolean;
  } = $props();
  const contentId = $props.id();
</script>

<svelte:document onclickcapture={event => {
  // Safari does not focus tapped buttons. Give overlays their actual invoking control.
  const trigger = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('button[aria-haspopup="dialog"], button[popovertarget]') : null;
  if (trigger && !trigger.disabled) trigger.focus({ preventScroll: true });
}} />

<div class={['app-shell', { 'app-shell--welcome': !header }]}>
  <a class="skip-link" href={`#${contentId}`}>Skip to workspace</a>
  {#if header}<header class="app-header">{@render header()}</header>{/if}
  {#if navigation}<nav class="rail" aria-label="Views">{@render navigation()}</nav>{/if}
  <main id={contentId} tabindex="-1" aria-label={header ? 'Workspace' : 'Welcome'} aria-busy={busy}>
    {@render children()}
  </main>
</div>

<style>
  /* Only the frame owns the viewport. Content and navigation scroll independently. */
  .app-shell {
    display: grid; grid-template-columns: 68px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr);
    block-size: 100vh; block-size: 100dvh; min-inline-size: 0; overflow: hidden;
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  }
  .app-shell--welcome { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .app-header {
    grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 24rem);
    align-items: center; gap: var(--spacing-sm) var(--spacing-lg); min-inline-size: 0;
    padding: var(--spacing-xs) var(--spacing-lg); border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-1); z-index: 3;
  }
  .app-header :global(.identity) { display: flex; align-items: center; gap: var(--spacing-lg); min-inline-size: 0; }
  .app-header :global(.home-button) { flex: none; min-block-size: var(--spacing-touch-h); padding: 0; font-size: 1rem; font-weight: 600; }
  .app-header :global(.case-name) {
    min-inline-size: 0; padding: var(--spacing-xs) var(--spacing-sm); font: var(--type-compact);
    color: var(--color-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .app-header :global(.header-search) { min-inline-size: 0; }
  .rail {
    display: flex; flex-direction: column; gap: var(--spacing-xs); min-block-size: 0; overflow: auto;
    overscroll-behavior: contain; padding: var(--spacing-sm) var(--spacing-xs);
    border-inline-end: 1px solid var(--color-border); background: var(--color-surface-2);
  }
  .rail :global(button) {
    display: flex; flex: none; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--spacing-2xs); min-block-size: 56px; padding: var(--spacing-sm) var(--spacing-2xs);
    border: 1px solid transparent; color: var(--color-text-2);
  }
  .rail :global(svg) { inline-size: 20px; block-size: 20px; }
  .rail :global(span) { max-inline-size: 100%; overflow-wrap: anywhere; font: var(--type-caption); font-weight: 500; }
  .rail :global(.export-trigger) { margin-block-start: auto; }
  .rail :global(.export-trigger), .rail :global(.preferences-trigger) { min-block-size: var(--spacing-touch-h); }
  .rail :global([aria-current="page"]) {
    background: var(--color-selected); color: var(--color-primary-text);
    border-color: var(--color-selection-border);
  }
  main { display: flex; flex-direction: column; min-inline-size: 0; min-block-size: 0; overflow: hidden; }
  .skip-link {
    position: fixed; inset-block-start: var(--spacing-sm); inset-inline-start: var(--spacing-sm); z-index: 10;
    padding: var(--spacing-md); background: var(--color-surface-1); color: var(--color-text-1);
    transform: translateY(calc(-100% - var(--spacing-lg)));
  }
  .skip-link:focus { transform: none; }
  @media (max-width: 767px) {
    .app-shell:not(.app-shell--welcome) { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; padding: 0; }
    /* The header owns top/side insets; the bottom rail's controls sit directly against the viewport edge. */
    .app-header { grid-template-columns: minmax(0, 1fr);
      padding: calc(var(--spacing-xs) + var(--safe-top)) calc(var(--spacing-sm) + var(--safe-right))
        var(--spacing-sm) calc(var(--spacing-sm) + var(--safe-left)); gap: var(--spacing-xs); }
    .app-header :global(.identity) { gap: var(--spacing-sm); }
    .rail {
      grid-row: 3; flex-direction: row; border-inline-end: 0; border-top: 1px solid var(--color-border);
      padding: var(--spacing-2xs) calc(var(--spacing-xs) + var(--safe-right))
        var(--spacing-2xs) calc(var(--spacing-xs) + var(--safe-left));
    }
    .rail :global(button) { flex: 1 0 0; min-inline-size: var(--spacing-touch-h); min-block-size: 56px; padding: var(--spacing-xs) 0; }
    .rail :global(.export-trigger), .rail :global(.preferences-trigger) { margin-block-start: 0; min-block-size: 56px; }
    main { grid-row: 2; }
    .app-shell:not(.app-shell--welcome) > main { padding-inline: var(--safe-left) var(--safe-right); }
    .app-shell--welcome > main { grid-row: 1; }
  }
  @media (min-width: 640px) and (max-width: 767px) and (max-height: 480px) {
    .app-header { grid-template-columns: minmax(0, 1fr) minmax(12rem, 1fr); padding-block-end: var(--spacing-xs); }
  }
  @media (min-width: 768px) and (max-height: 480px) {
    .rail :global(button) { min-block-size: var(--spacing-touch-h); padding-block: var(--spacing-2xs); }
    .rail :global(svg) { inline-size: 16px; block-size: 16px; }
    .rail :global(span) { font-size: 0.75rem; }
  }
  @media (forced-colors: active) {
    .rail :global([aria-current="page"]) { border-color: Highlight; }
  }
</style>
