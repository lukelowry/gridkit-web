<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  let {
    label,
    value = $bindable(''),
    input = $bindable<HTMLInputElement>(),
    trailing,
    ...rest
  }: Omit<HTMLInputAttributes, 'type' | 'value' | 'children' | 'autofocus'> & {
    label: string;
    value?: string;
    input?: HTMLInputElement | undefined;
    trailing?: Snippet;
  } = $props();
  let root: HTMLDivElement;
  let resumeTyping = false;
  /** A stable return target when clearing a filter or closing a search result. */
  export function focus() { root.focus({ preventScroll: true }); }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Only forwards Tab from programmatic group focus to the native input.) -->
<div class="c-field search-field" role="group" aria-label={label} tabindex="-1" bind:this={root}
  onkeydown={event => {
    // Enter the field from a browsing return target, even if Safari remembers Clear's old Tab position.
    if (event.target === root && event.key === 'Tab' && !event.shiftKey && input && !input.disabled) {
      event.preventDefault();
      input.focus();
    }
  }}>
  <Icon name="search" />
  <input
    type="search"
    aria-label={label}
    placeholder={label}
    autocomplete="off"
    spellcheck="false"
    {...rest}
    bind:this={input}
    bind:value
  />
  {@render trailing?.()}
  {#if value}
    <button
      type="button"
      class="c-icon-btn search-field__clear"
      aria-label="Clear search"
      onpointerdown={() => { resumeTyping = document.activeElement === input; }}
      onmousedown={event => { if (resumeTyping) event.preventDefault(); }}
      onpointercancel={() => { resumeTyping = false; }}
      onkeydown={() => { resumeTyping = false; }}
      onclick={() => {
        const typing = resumeTyping || document.activeElement === input;
        resumeTyping = false;
        value = '';
        if (typing) input?.focus({ preventScroll: true });
        else focus();
      }}><Icon name="close" /></button
    >
  {/if}
</div>

<style>
  .search-field {
    min-inline-size: 0;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .search-field__clear {
    flex: none;
    margin-inline-end: calc(-1 * var(--spacing-xs));
  }
  .search-field__clear :global(svg) {
    inline-size: 0.75rem;
    block-size: 0.75rem;
  }
</style>
