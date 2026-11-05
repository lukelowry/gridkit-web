<script lang="ts">
  import Icon from './Icon.svelte';
  let { name, label, background, checked, onchange }: {
    name: string; label: string; background: string; checked: boolean; onchange?: () => void;
  } = $props();
</script>
<label class="swatch" title={label}>
  <input type="radio" {name} aria-label={label} {checked} {onchange} />
  <i class="c-ramp" style:background></i><Icon name="check" />
</label>
<style>
  .swatch { position: relative; display: grid; align-items: center; min-inline-size: var(--spacing-touch-h); min-block-size: var(--spacing-touch-h); padding: 4px; border: 2px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
  input { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0; opacity: 0; cursor: pointer; }
  .c-ramp { width: 100%; pointer-events: none; }
  .swatch > :global(svg) { visibility: hidden; position: absolute; right: 1px; bottom: 1px; width: 12px; height: 12px; padding: 1px; background: var(--color-surface-1); color: var(--color-primary-text); pointer-events: none; }
  .swatch:has(input:checked) { border-color: var(--color-selection-border); }
  .swatch:has(input:checked) > :global(svg) { visibility: visible; }
  .swatch:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: calc(-1 * var(--focus-width)); }
  @media (forced-colors: active) {
    .swatch { border-color: ButtonBorder; }
    .swatch:has(input:checked) { border-color: Highlight; }
    .swatch > :global(svg) { color: Highlight; background: Canvas; }
  }
</style>
