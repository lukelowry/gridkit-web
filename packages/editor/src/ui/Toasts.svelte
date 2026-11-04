<script lang="ts">
  import Icon from './Icon.svelte';
  import { dismiss, toasts } from './toasts.svelte.js';
</script>

<!-- Over the workspace and above the results, newest last; a message arriving never moves the views under it. -->
<section class="toasts" aria-label="Notifications">
  {#each toasts as toast (toast.id)}
    <div class={['toast', toast.tone]} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span class="toast__mark"><Icon name={toast.tone === 'error' ? 'warning' : 'info'} /></span>
      <div class="toast__body">
        <p dir="auto">{toast.text}</p>
        {#if toast.link || toast.action}
          <div class="toast__actions">
            {#if toast.link}<a class="toast__action" href={toast.link.href} download={toast.link.file} onclick={() => dismiss(toast.id)}>{toast.link.label}</a>{/if}
            {#if toast.action}
              {@const action = toast.action}
              <button type="button" class="toast__action" onclick={() => { dismiss(toast.id); action.run(); }}>{action.label}</button>
            {/if}
          </div>
        {/if}
      </div>
      <button type="button" class="c-icon-btn" aria-label="Dismiss" title="Dismiss" onclick={() => dismiss(toast.id)}><Icon name="close" /></button>
    </div>
  {/each}
</section>

<style>
  .toasts { --toast-bottom: min(calc(var(--dock-height, 0px) + 12px), max(0px, calc(100% - 3 * var(--control-height))));
    position: absolute; inset-inline-end: calc(12px + var(--dock-width, 0px)); bottom: var(--toast-bottom); z-index: 3; display: grid; justify-items: end; gap: 8px;
    max-width: min(28rem, calc(100% - 24px - var(--dock-width, 0px))); max-height: calc(100% - var(--toast-bottom) - 8px);
    overflow: auto; overscroll-behavior: contain; }
  .toast { --toast-color: var(--color-info); --toast-surface: var(--color-info-surface);
    display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px 6px 12px;
    border: 1px solid color-mix(in oklch, var(--toast-color) 40%, var(--toast-surface));
    border-radius: var(--radius-lg); background: var(--toast-surface); color: var(--toast-color); box-shadow: var(--shadow-overlay);
    min-width: 0; max-width: 100%; font: var(--type-compact); }
  .toast.error { --toast-color: var(--color-error); --toast-surface: var(--color-error-surface); }
  .toast__mark { display: flex; padding-block: 7px; }
  .toast__body { flex: 1; min-width: 0; }
  .toast p { margin: 0; padding-block: 6px; overflow-wrap: anywhere; }
  /* Actions follow the message, their labels lined up with its first letter. */
  .toast__actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 2px -8px; }
  .toast__action { display: inline-flex; align-items: center; min-height: var(--control-height); padding: 4px 8px; border: 0;
    border-radius: var(--radius-md); background: transparent; color: inherit; font: var(--type-label); text-decoration: none;
    white-space: normal; overflow-wrap: anywhere; }
  .toast__action:hover { background: color-mix(in oklch, var(--toast-color) 10%, transparent); }
  .toast .c-icon-btn { flex: none; }
  :global(:root[data-motion="full"]) .toast { animation: toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } }
  @media (max-width: 640px) { .toasts { inset-inline: 8px; max-width: none; justify-items: stretch; } }
</style>
