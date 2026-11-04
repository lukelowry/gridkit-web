<script lang="ts">
  import { tick } from 'svelte';
  import { models, type Model } from '@gridkit/library';
  import Icon from '../ui/Icon.svelte';
  import Popover from '../ui/Popover.svelte';
  import SearchField from '../ui/SearchField.svelte';
  let { onchoose, disabled = false }: { onchoose: (model: Model) => void; disabled?: boolean } = $props();
  let query = $state('');
  let family = $state('');
  let results = $state<HTMLDivElement>();
  const families = [...new Set(models.map(model => model.family))].sort();
  const shown = $derived(models.filter(model => query.trim()
    ? `${model.label} ${model.id} ${model.family}`.toLowerCase().includes(query.trim().toLowerCase())
    : model.family === family));
  async function back() {
    const previous = family;
    family = '';
    await tick();
    [...results?.querySelectorAll<HTMLButtonElement>('button') ?? []]
      .find(button => button.getAttribute('aria-label') === previous)?.focus();
  }
  function keyboard(event: KeyboardEvent) {
    const buttons = [...results?.querySelectorAll<HTMLButtonElement>('button') ?? []];
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'ArrowLeft' && family) { event.preventDefault(); void back(); }
    else if (event.key === 'ArrowRight' && !family && !query) { event.preventDefault(); (event.currentTarget as HTMLButtonElement).click(); }
  }
</script>

<Popover label="Add model" width={300} align="end" onopen={() => { query = ''; family = ''; }}>
  {#snippet trigger(popup)}
    <button class="c-icon-btn" type="button" popovertarget={popup} {disabled} aria-label="Add model" title="Add model"><Icon name="new" /></button>
  {/snippet}
  {#snippet children(close)}
    <div class="picker-search">
      <SearchField label="Find models" bind:value={query} onkeydown={event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); results?.querySelector<HTMLButtonElement>('button')?.focus(); }
      }} />
    </div>
    {#if family && !query}
      <button type="button" class="c-action back" onclick={back}><Icon name="undo" />All models<span>{family}</span></button>
    {/if}
    <div class="model-choices" bind:this={results} role="group" aria-label={family || 'Models'}>
      {#each shown as model (model.id)}
        <button class="c-action" type="button" aria-label={model.label} onkeydown={keyboard} onclick={() => { close(); onchoose(model); }}>
          <Icon name={model.ends ? 'branch' : model.collection === 'buses' ? 'bus' : 'settings'} /><span>{model.label}</span>
          {#if query}<small>{model.family}</small>{/if}
        </button>
      {/each}
      {#if !family && !query}
        {#each families as category (category)}
          <button class="c-action" type="button" aria-label={category} onkeydown={keyboard} onclick={() => { family = category; void tick().then(() => results?.querySelector<HTMLButtonElement>('button')?.focus()); }}><span>{category}</span><span class="forward"><Icon name="chevron" /></span></button>
        {/each}
      {:else if !shown.length}<p class="property-empty">No matching models.</p>{/if}
    </div>
  {/snippet}
</Popover>

<style>
  .picker-search { padding: var(--spacing-sm); border-bottom: 1px solid var(--color-border); }
  .model-choices { padding: var(--spacing-xs); overflow: auto; max-height: 24rem; }
  .model-choices button > span:first-of-type { flex: 1; }
  small, .back span { color: var(--color-text-3); font: var(--type-caption); }
  .back { padding: var(--spacing-sm); border-bottom: 1px solid var(--color-divider); }
  .back span { margin-left: auto; }
  .forward { display: flex; transform: rotate(-90deg); }
  .property-empty { padding: var(--spacing-sm); }
</style>
