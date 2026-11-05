<script lang="ts">
  let { busy, label }: { busy: boolean; label: string } = $props();
</script>

{#if busy}<div class="loading-bar" role="progressbar" aria-label={label}></div>{/if}

<style>
  .loading-bar { position: absolute; inset: 0 0 auto; height: 2px; overflow: hidden; pointer-events: none; z-index: 1;
    opacity: 0; animation: reveal 0s 180ms forwards; }
  .loading-bar::after { content: ''; display: block; height: 100%; width: 30%; background: var(--color-primary-text);
    animation: loading 1.4s ease-in-out infinite; }
  @keyframes reveal { to { opacity: 1; } }
  @keyframes loading { from { transform: translateX(-100%); } to { transform: translateX(434%); } }
  :global(:root[data-motion="reduce"]) .loading-bar::after { animation: none; width: 100%; }
  @media (prefers-reduced-motion: reduce) { .loading-bar::after { animation: none; width: 100%; } }
  @media (forced-colors: active) { .loading-bar::after { background: Highlight; forced-color-adjust: none; } }
</style>
