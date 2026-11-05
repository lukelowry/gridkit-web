<script lang="ts">
  import { onMount } from 'svelte';
  import { observeViewport, viewportBounds } from './viewport.js';
  import Icon from './Icon.svelte';
  import { dismiss, toasts, notificationHosts, registerNotifications } from './toasts.svelte.js';
  const id = $props.id();
  let host: HTMLElement;
  const active = $derived(notificationHosts.at(-1) === id);
  onMount(() => registerNotifications(id));
  $effect(() => {
    const messages = toasts.map(toast => toast.id).join();
    if (!active || !messages) { host.hidePopover(); return; }
    function fit() {
      const visible = viewportBounds();
      const parent = (host.closest('dialog')?.querySelector('.dialog-content') ?? host.parentElement)!.getBoundingClientRect();
      const left = Math.max(visible.left, parent.left), top = Math.max(visible.top, parent.top);
      const right = Math.min(visible.right, parent.right), bottom = Math.min(visible.bottom, parent.bottom);
      const box = { right, bottom, width: right - left, height: bottom - top };
      host.style.right = Math.max(8, innerWidth - box.right + 8) + 'px';
      host.style.bottom = Math.max(8, innerHeight - box.bottom + 8) + 'px';
      host.style.maxWidth = Math.max(0, Math.min(448, box.width - 16)) + 'px';
      host.style.maxHeight = Math.max(0, box.height - 16) + 'px';
    }
    fit(); host.hidePopover(); host.showPopover();
    const resize = new ResizeObserver(fit);
    resize.observe(host.closest('dialog') ?? host.parentElement!);
    const stop = observeViewport(fit);
    return () => { stop(); resize.disconnect(); };
  });
  function closeMessage(event: MouseEvent, toastId: number) {
    const button = event.currentTarget as HTMLElement;
    const restore = button.closest('dialog')?.querySelector<HTMLElement>('header > button')
      ?? document.querySelector<HTMLElement>('[aria-current="page"]');
    dismiss(toastId);
    restore?.focus({ preventScroll: true });
  }
</script>

<!-- Over the workspace and above the results, newest last; a message arriving never moves the views under it. -->
<section class="toasts" aria-label="Notifications" popover="manual" bind:this={host}>
  {#each active ? toasts : [] as toast (toast.id)}
    <div class={['toast', toast.tone]} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span class="toast__mark"><Icon name={toast.tone === 'error' ? 'warning' : 'info'} /></span>
      <div class="toast__body">
        <p dir="auto">{toast.text}</p>
        {#if toast.link || toast.action || toast.secondary}
          <div class="toast__actions">
            {#if toast.link}<a class="toast__action" href={toast.link.href} download={toast.link.file} onclick={() => dismiss(toast.id)}>{toast.link.label}</a>{/if}
            {#each [toast.action, toast.secondary].filter(Boolean) as action (action)}
              {#if action}
              <button type="button" class="toast__action" onclick={() => { dismiss(toast.id); action.run(); }}>{action.label}</button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      <button type="button" class="c-icon-btn" aria-label="Dismiss" title="Dismiss" onclick={event => closeMessage(event, toast.id)}><Icon name="close" /></button>
    </div>
  {/each}
</section>

<style>
  .toasts { position: fixed; inset: auto; margin: 0; padding: 0; border: 0; background: transparent; color: inherit;
    width: max-content; overflow: auto; overscroll-behavior: contain; }
  .toasts:popover-open { display: grid; justify-items: end; gap: 8px; }
  .toast { --toast-color: var(--color-info); --toast-surface: var(--color-info-surface);
    display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px 6px 12px;
    border: 1px solid color-mix(in oklch, var(--toast-color) 40%, var(--toast-surface));
    border-radius: var(--radius-lg); background: var(--toast-surface); color: var(--toast-color); box-shadow: var(--shadow-overlay);
    min-width: 0; max-width: 100%; font: var(--type-compact); }
  .toast.error { --toast-color: var(--color-error); --toast-surface: var(--color-error-surface); }
  .toast__mark { display: flex; padding-block: 7px; }
  .toast__body { flex: 1; min-width: 0; }
  .toast p { margin: 0; padding-block: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
  /* Actions follow the message, their labels lined up with its first letter. */
  .toast__actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 2px -8px; }
  .toast__action { display: inline-flex; align-items: center; min-height: var(--control-height); padding: 4px 8px; border: 0;
    border-radius: var(--radius-md); background: transparent; color: inherit; font: var(--type-label); text-decoration: none;
    white-space: normal; overflow-wrap: anywhere; }
  .toast__action:hover { background: color-mix(in oklch, var(--toast-color) 10%, transparent); }
  .toast .c-icon-btn { flex: none; }
  :global(:root[data-motion="full"]) .toast { animation: toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } }
</style>
