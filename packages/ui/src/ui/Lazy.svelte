<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';
  import Notice from './Notice.svelte';
  import { errorMessage } from './errors.js';
  let { load, children }: { load: () => Promise<T>; children: Snippet<[T]> } = $props();
  let pending = $state.raw(untrack(() => load()));
</script>
{#await pending then module}{@render children(module)}
{:catch error}<Notice message={errorMessage(error, 'This panel could not be loaded.')} action={{ label: 'Try again', run: () => { pending = load(); } }} />
{/await}
