<script lang="ts">
  let { orientation, value, min, max, controls, label, onresize, onreset }: {
    orientation: 'horizontal' | 'vertical';
    value: number; min: number; max: number;
    controls: string; label: string;
    onresize: (value: number) => void;
    onreset: () => void;
  } = $props();
  let drag = $state<{ pointer: number; origin: number; value: number } | null>(null);
  const position = (event: PointerEvent) => orientation === 'vertical' ? event.clientX : event.clientY;
  const resize = (next: number) => onresize(Math.round(Math.max(min, Math.min(max, next))));

  function start(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, origin: position(event), value };
    event.preventDefault();
  }
  function finish(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    drag = null;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  function keydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    const backward = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const forward = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === backward) resize(value + step);
    else if (event.key === forward) resize(value - step);
    else if (event.key === 'Home') resize(min);
    else if (event.key === 'End') resize(max);
    else if (event.key === 'Enter') onreset();
    else if (event.key === 'Escape' && drag) {
      const pointer = drag.pointer;
      resize(drag.value); drag = null;
      const handle = event.currentTarget as HTMLElement;
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    }
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<!-- A focusable separator is the WAI-ARIA window-splitter widget. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class={['resize-handle', orientation, { dragging: drag !== null }]}
  role="separator" tabindex="0" aria-label={label} aria-orientation={orientation} aria-controls={controls}
  aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}
  aria-valuetext={`${Math.round(value)} pixels`} title={`${label}. Drag or use arrow keys; Enter resets.`}
  onpointerdown={start} onpointermove={event => {
    if (drag?.pointer === event.pointerId) resize(drag.value + drag.origin - position(event));
  }} onpointerup={finish} onpointercancel={finish} onlostpointercapture={() => { drag = null; }}
  onkeydown={keydown} ondblclick={onreset}>
  <span aria-hidden="true"></span>
</div>

<style>
  /* The thin boundary has a larger invisible hit area; its grip is also a full-size touch target. */
  .resize-handle { position: absolute; z-index: 4; touch-action: none; user-select: none; color: var(--color-text-3); }
  .horizontal { inset: -6px 0 auto; height: 12px; cursor: ns-resize; }
  .vertical { inset: 0 auto 0 -6px; width: 12px; cursor: ew-resize; }
  .resize-handle::before { content: ''; position: absolute; background: var(--color-border); }
  .horizontal::before { inset: 5px 0 auto; height: 1px; }
  .vertical::before { inset: 0 auto 0 5px; width: 1px; }
  .resize-handle span { position: absolute; display: grid; place-items: center; width: 44px; height: 44px; }
  .horizontal span { left: calc(50% - 22px); top: -16px; }
  .vertical span { top: calc(50% - 22px); left: -16px; }
  .resize-handle span::after { content: ''; border-radius: var(--radius-sm); background: currentColor; box-shadow: 0 0 0 3px var(--color-surface-1); }
  .horizontal span::after { width: 28px; height: 3px; }
  .vertical span::after { width: 3px; height: 28px; }
  .resize-handle:hover, .resize-handle:focus-visible, .dragging { color: var(--color-primary-text); }
  .resize-handle:hover::before, .resize-handle:focus-visible::before, .dragging::before { background: currentColor; }
  .resize-handle:focus-visible { outline: none; }
  .resize-handle:focus-visible span::after { outline: var(--focus-ring); outline-offset: 3px; }
  @media (forced-colors: active) {
    .resize-handle { color: ButtonText; }
    .resize-handle::before, .resize-handle span::after { background: currentColor; forced-color-adjust: none; }
    .resize-handle:focus-visible { color: Highlight; }
  }
</style>
