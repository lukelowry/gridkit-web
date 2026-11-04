<script lang="ts">
  import { onDestroy } from 'svelte';
  import { errorMessage } from '../ui/errors.js';
  import type { Connection } from '../services/connection.svelte.js';
  import Dialog from '../ui/Dialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import type { Library, LibraryEntry } from '@gridkit/library';

  let { library, onopen, onclose }: {
    library: Connection<Library>;
    /** Opens a case as the editor opens any file; the dialog closes first. */
    onopen: (file: File) => void;
    onclose: () => void;
  } = $props();
  const favoriteDescription = $props.id();
  const request = new AbortController();
  onDestroy(() => request.abort());
  let folder = $state('');
  let query = $state('');
  let favorites = $state.raw<readonly string[]>([]);
  let favoritesError = $state('');
  let search = $state<SearchField>();
  let listed = $state.raw<readonly LibraryEntry[] | null>(null);
  let listError = $state('');
  let opening = $state('');
  let failed = $state.raw<{ path: string; message: string } | null>(null);
  const crumbs = $derived(folder.split('/').filter(Boolean));
  const favoritePaths = $derived(new Set(favorites));
  const term = $derived(query.trim().toLocaleLowerCase());
  const matches = $derived(listed?.filter(entry => entry.title.toLocaleLowerCase().includes(term)) ?? []);

  // Favorite markers load independently; metadata never holds up browsing.
  $effect(() => {
    const current = library.value;
    favorites = []; favoritesError = '';
    if (!current) return;
    const loading = new AbortController();
    current.favorites(loading.signal).then(paths => {
      if (loading.signal.aborted) return;
      favorites = paths;
    }, cause => {
      if (loading.signal.aborted) return;
      favoritesError = errorMessage(cause, 'Favorites could not be loaded.');
    });
    return () => loading.abort();
  });

  // Each folder is listed afresh as it is shown; one unchanged since is answered from the browser's cache.
  $effect(() => {
    const current = library.value, at = folder;
    if (!current) return;
    const loading = new AbortController();
    listed = null; listError = '';
    current.list(at, loading.signal).then(entries => { if (!loading.signal.aborted) listed = entries; },
      cause => { if (!loading.signal.aborted) listError = errorMessage(cause, 'Could not list the library.'); });
    return () => loading.abort();
  });

  function show(next: string) { folder = next; query = ''; failed = null; search?.focus(); }
  async function choose(entry: Pick<LibraryEntry, 'path' | 'folder'>) {
    if (opening) return;
    if (entry.folder) { show(entry.path); return; }
    opening = entry.path; failed = null;
    try {
      const file = await library.value!.open(entry, request.signal);
      if (request.signal.aborted) return;
      onclose();
      onopen(file);
    } catch (cause) {
      if (!request.signal.aborted) failed = { path: entry.path, message: errorMessage(cause, 'Could not open the case.') };
    } finally { opening = ''; }
  }
</script>

<Dialog label="Library" closeLabel="Close library" compact busy={!!opening} {onclose}>
  <div class="library">
    <span id={favoriteDescription} hidden>Favorite</span>
    {#if library.status === 'unreachable'}
      <div class="library__state" role="alert">
        <p>{library.error}</p>
        <div class="library__actions">
          <button type="button" disabled={library.pending} onclick={() => void library.connect()}>{library.pending ? 'Trying…' : 'Try again'}</button>
        </div>
      </div>
    {:else}
      <SearchField label="Find a case" bind:this={search} bind:value={query} disabled={!!opening}
        onkeydown={event => { if (event.key === 'Enter' && matches[0]) { event.preventDefault(); void choose(matches[0]); } }} />
      {#if folder}
        <nav class="library__trail" aria-label="Folder">
          <button type="button" disabled={!!opening} onclick={() => show('')}>Library</button>
          {#each crumbs as crumb, index (index)}
            <span aria-hidden="true">/</span>
            <button type="button" disabled={!!opening} aria-current={index === crumbs.length - 1 ? 'location' : undefined}
              onclick={() => show(`${crumbs.slice(0, index + 1).join('/')}/`)}>{crumb}</button>
          {/each}
        </nav>
      {/if}
      <div class="library__content c-scroll-region">
        {#if favoritesError}<p class="library__error" role="alert">{favoritesError} You can still browse the library.</p>{/if}
        {#if listError}
          <p class="library__state" role="alert">{listError}</p>
        {:else if !listed}
          <p class="library__state" role="status">Loading…</p>
        {:else}
          <ul aria-label="Cases">
            {#each matches as entry (entry.path)}
              {@const favorite = !entry.folder && favoritePaths.has(entry.path)}
              <li>
                <button type="button" class={['c-action library__entry', { favorite }]} aria-describedby={favorite ? favoriteDescription : undefined}
                  aria-busy={opening === entry.path} disabled={!!opening} title={entry.path} onclick={() => void choose(entry)}>
                  <Icon name={entry.folder ? 'folder' : favorite ? 'star' : 'file'} />
                  <span class="library__title">{entry.title}</span>
                  {#if opening === entry.path}<span class="library__opening" role="status">Opening…</span>{/if}
                </button>
                {#if failed?.path === entry.path}<p class="library__error" role="alert">{failed.message}</p>{/if}
              </li>
            {:else}
              <li class="library__state">{query.trim() ? 'No matching cases.' : 'No cases here.'}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</Dialog>

<style>
  .library { display: flex; flex-direction: column; block-size: 28rem; min-block-size: 0; gap: var(--spacing-sm); padding: var(--spacing-md); }
  .library__content { flex: 1; }
  .library__trail { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; color: var(--color-text-3); font: var(--type-caption); }
  .library__trail button { min-height: var(--control-height); padding: 0 6px; color: var(--color-text-2); font: inherit; }
  .library__trail button[aria-current] { color: var(--color-text-1); }
  ul { margin: 0; padding: 0; list-style: none; }
  .library__entry { padding-inline: var(--spacing-sm); }
  .library__entry :global(svg) { color: var(--color-text-3); }
  .library__entry.favorite :global(svg) { color: var(--color-text-1); fill: currentColor; }
  .library__title { min-width: 0; overflow: hidden; color: var(--color-text-1); text-overflow: ellipsis; white-space: nowrap; }
  .library__opening { flex: none; margin-left: auto; color: var(--color-text-3); font: var(--type-caption); }
  .library__state, .library__error { margin: var(--spacing-sm); color: var(--color-text-2); font: var(--type-compact); overflow-wrap: anywhere; }
  .library__state p { margin: 0 0 var(--spacing-md); }
  .library__actions { display: flex; justify-content: flex-end; gap: var(--spacing-sm); }
  .library__error { margin-top: 0; color: var(--color-error); }
</style>
