<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';
  import Notice from './Notice.svelte';
  import { errorMessage, reload } from './errors.js';
  let { load, children }: { load: () => Promise<T>; children: Snippet<[T]> } = $props();
  let pending = $state.raw(untrack(() => load()));
  /** Each browser's words for a module it could not fetch: the files this page was built with are gone since it opened. */
  const replaced = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
</script>
{#await pending then module}{@render children(module)}
{:catch error}
  {@const message = errorMessage(error, 'This panel could not be loaded.')}
  {#if replaced.test(message)}
    <Notice message="This panel could not load. Reload the application to get the current files." action={reload} />
  {:else}
    <Notice {message} action={{ label: 'Try again', run: () => { pending = load(); } }} />
  {/if}
{/await}
