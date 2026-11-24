<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ExprInput } from 'latkit';
  import { parseInput, type InputIssue, type InputKind } from './expression-input.js';
  let { label, value, kind, placeholder, onissue, onchange }: {
    label: string; value: unknown; kind: InputKind; placeholder: string; onissue: InputIssue;
    onchange: (value: ExprInput | undefined) => void;
  } = $props();
  const key = $props.id();
  const text = $derived(value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value));
  let error = $state('');
  function check(input: HTMLInputElement, apply: boolean) {
    try {
      const next = parseInput(input.value, kind);
      if (apply) onchange(next);
      error = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid expression.'; }
    onissue(key, error);
    input.setCustomValidity(error);
  }
  onDestroy(() => onissue(key));
</script>

<input aria-label={label} value={text} {placeholder} aria-invalid={!!error || undefined} aria-describedby={error ? key : undefined}
  oninput={({ currentTarget }) => check(currentTarget, false)} onchange={({ currentTarget }) => check(currentTarget, true)} />
{#if error}<small id={key}>{error}</small>{/if}

<style>
  input { flex: 1; min-width: 0; width: 100%; }
  small { color: var(--color-text); }
</style>
