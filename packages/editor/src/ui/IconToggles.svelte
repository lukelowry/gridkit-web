<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.js';

  /**
   * One of a few choices as the toolbars show them, glyphs pressed in place. With `onclear`, pressing the chosen one again
   * clears it, for choices that are all optional.
   */
  let { label, value, options, onchange, onclear, disabled = false }: {
    label: string; value: T | null; onchange: (value: T) => void; onclear?: (() => void) | undefined; disabled?: boolean;
    options: readonly { readonly value: T; readonly label: string; readonly icon: IconName; readonly disabled?: boolean }[];
  } = $props();
</script>

<div class="c-toolbar__group" role="group" aria-label={label}>
  {#each options as option (option.value)}
    <button type="button" class="c-icon-btn" aria-label={option.label} title={option.label} aria-pressed={option.value === value} disabled={disabled || option.disabled}
      onclick={() => { if (option.value !== value) onchange(option.value); else onclear?.(); }}><Icon name={option.icon} /></button>
  {/each}
</div>
