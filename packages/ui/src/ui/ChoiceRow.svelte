<script lang="ts">
  let { label, detail, selected, disabled = false, title, ariaLabel, onselect }: {
    label: string; detail?: string | undefined; selected: boolean; disabled?: boolean; title?: string; ariaLabel?: string; onselect: () => void;
  } = $props();
</script>
<button type="button" class="c-choice" data-picker-choice aria-label={ariaLabel} aria-pressed={selected} {disabled} {title} onclick={onselect}>
  <span>{label}</span>{#if detail}<small>{detail}</small>{/if}
</button>
<style>
  .c-choice { display: flex; align-items: center; gap: var(--spacing-sm); width: 100%; min-height: var(--control-height); padding: var(--spacing-xs) var(--spacing-sm); text-align: left; font: var(--type-control); }
  span { min-width: 0; overflow-wrap: anywhere; }
  small { margin-inline-start: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-caption); color: var(--color-text-3); font-variant-numeric: tabular-nums; }
  [aria-pressed="true"] { background: var(--color-selected); color: var(--color-primary-text); border-color: var(--color-selection-border); font-weight: 500; }
  [aria-pressed="true"] small { color: inherit; }
</style>
