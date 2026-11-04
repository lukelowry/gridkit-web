<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { label, closeLabel = 'Close', compact = false, busy = false, onclose, children, footer, leading, tabs }: {
    label: string; closeLabel?: string; compact?: boolean;
    /** While busy, a press outside the dialog leaves it open; Esc and Close still ask `onclose`. */
    busy?: boolean;
    onclose: () => void; children: Snippet; footer?: Snippet; leading?: Snippet;
    /** Tabs beside the title, choosing what the whole dialog shows. */
    tabs?: Snippet;
  } = $props();
  const heading = $props.id();
  let backdropPress = false;

  function mount(modal: HTMLDialogElement) {
    const opener = document.activeElement;
    // On iPad the keyboard can shrink/pan the visual viewport without changing dvh.
    // Keep every dialog within the visible area, including after keyboard dismissal.
    const viewport = window.visualViewport;
    function fitViewport() {
      modal.style.setProperty('--dialog-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
      modal.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      modal.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      modal.style.setProperty('--dialog-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    }
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    window.addEventListener('resize', fitViewport);
    modal.showModal();
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      window.removeEventListener('resize', fitViewport);
      modal.close();
      // Svelte can remove the dialog before cleanup, bypassing native focus restoration.
      if (document.activeElement === document.body && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }

  function outside(event: MouseEvent | PointerEvent) {
    if (event.target !== event.currentTarget) return false;
    const bounds = (event.currentTarget as HTMLDialogElement).getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
</script>

<dialog aria-labelledby={heading} class={{ compact }} {@attach mount}
  oncancel={event => { event.preventDefault(); onclose(); }}
  onpointerdown={event => { backdropPress = outside(event); }}
  onpointercancel={() => { backdropPress = false; }}
  onclick={event => {
    if (!busy && backdropPress && outside(event)) onclose();
    backdropPress = false;
  }}>
  <header>
    <h2 id={heading} class:fill={!tabs}>{label}</h2>
    {#if tabs}<div class="tabs">{@render tabs()}</div>{/if}
    <button type="button" class="c-icon-btn" aria-label={closeLabel} title={closeLabel} onclick={onclose}><Icon name="close" /></button>
  </header>
  <div class="dialog-body">{@render children()}</div>
  {#if footer || leading}<footer>{#if leading}<div class="footer-leading">{@render leading()}</div>{/if}{@render footer?.()}</footer>{/if}
</dialog>

<style>
  dialog {
    --dialog-width: calc(var(--dialog-viewport-width, 100vw) - 32px - var(--safe-left) - var(--safe-right));
    --dialog-height: calc(var(--dialog-viewport-height, 100dvh) - 32px - var(--safe-top) - var(--safe-bottom));
    position: fixed;
    inset: var(--dialog-viewport-top, 0px)
      calc(100% - var(--dialog-viewport-left, 0px) - var(--dialog-viewport-width, 100vw))
      calc(100% - var(--dialog-viewport-top, 0px) - var(--dialog-viewport-height, 100dvh))
      var(--dialog-viewport-left, 0px);
    inline-size: min(56rem, var(--dialog-width)); block-size: min(38rem, var(--dialog-height));
    max-inline-size: none; max-block-size: none; margin: auto; padding: 0; overflow: hidden;
    border: 1px solid var(--color-border); border-radius: var(--radius-lg);
    background: var(--color-surface-1); color: var(--color-text-1); box-shadow: var(--shadow-overlay);
  }
  dialog[open] { display: flex; flex-direction: column; }
  dialog.compact { inline-size: min(28rem, var(--dialog-width)); block-size: fit-content; max-block-size: var(--dialog-height); }
  dialog::backdrop { background: rgb(0 0 0 / 0.55); }
  header { display: flex; flex-wrap: wrap; align-items: center; flex-shrink: 0; min-height: var(--control-height); padding-inline-start: 12px; border-bottom: 1px solid var(--color-border); }
  h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fill { flex: 1; }
  .tabs { display: flex; flex: 1; align-items: center; min-width: 0; margin-left: var(--spacing-md); }
  footer { display: flex; flex-wrap: wrap; flex-shrink: 0; align-items: center; justify-content: flex-end; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--color-border); background: var(--color-surface-2); }
  footer :global(button) { min-height: var(--control-height); padding: 3px 12px; }
  footer :global(button:not(.c-icon-btn):not(.primary)) { border-color: var(--color-border); background: var(--color-surface-1); }
  footer :global(button:not(.c-icon-btn):not(.primary):hover:not(:disabled)) { background: var(--color-row-hover); }
  footer :global(.primary) { min-width: 64px; }
  footer :global(.c-icon-btn) { padding: 0; }
  .footer-leading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-inline-end: auto; }
  .dialog-body { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; flex-direction: column; }
  .dialog-body :global(.dialog-form) { display: flex; flex: 1; min-height: 0; max-width: none; }
  @media (max-width: 640px) {
    dialog:not(.compact) { inline-size: var(--dialog-viewport-width, 100vw); block-size: var(--dialog-viewport-height, 100dvh); margin: 0; padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); border: 0; border-radius: 0; }
    header { min-height: 44px; }
  }
  @media (forced-colors: active) { dialog { border: 2px solid CanvasText; } }
</style>
