<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.js';

  let { label, sections, active = $bindable(), children }: {
    label: string;
    sections: readonly { id: string; label: string; icon: IconName; group?: string; panel?: boolean }[];
    active?: string | undefined;
    children: Snippet;
  } = $props();
  active ??= untrack(() => sections[0]?.id);
  let list: HTMLDivElement;
  const groups = $derived.by(() => {
    const groups: { label: string; sections: typeof sections[number][] }[] = [];
    for (const section of sections) {
      const label = section.group ?? '';
      if (groups.at(-1)?.label !== label) groups.push({ label, sections: [] });
      groups.at(-1)!.sections.push(section);
    }
    return groups;
  });
  async function go(id: string) {
    active = id;
    await tick();
    const section = [...list.querySelectorAll<HTMLElement>('[data-section]')]
      .find(section => section.dataset.section === id);
    if (section) list.scrollTop = section.offsetTop;
  }
  function follow() {
    if (sections.find(section => section.id === active)?.panel) return;
    const elements = [...list.querySelectorAll<HTMLElement>('[data-section]')].filter(element => !element.closest('[hidden]'));
    const current = elements.find(section => section.dataset.section === active);
    if (current && current.offsetTop >= list.scrollTop && current.offsetTop < list.scrollTop + list.clientHeight) return;
    active = elements.filter(section => section.offsetTop <= list.scrollTop + 1).at(-1)?.dataset.section ?? sections[0]?.id;
  }
</script>

<div class="property-layout">
  <nav class="property-nav" class:grouped={groups.length > 1} aria-label={label}>
    {#each groups as group (group.label)}
      <div class="section-group" role="group" aria-label={group.label || label}>
        {#if group.label}<div class="section-divider"><span>{group.label}</span></div>{/if}
        <div class="section-links">
          {#each group.sections as section (section.id)}
            <button type="button" class="category-link" aria-current={active === section.id ? 'true' : undefined}
              onclick={() => go(section.id)}><Icon name={section.icon} />{section.label}</button>
          {/each}
        </div>
      </div>
    {/each}
  </nav>
  <div class="property-list c-scroll-region" bind:this={list} onscroll={follow}>
    {@render children()}
  </div>
</div>

<style>
  .section-divider { display: flex; align-items: center; gap: var(--spacing-xs); margin-block: var(--spacing-md) var(--spacing-xs); color: var(--color-text-3); font: var(--type-caption); }
  .section-divider::before, .section-divider::after { content: ''; border-top: 1px solid var(--color-border); }
  .section-divider::before { width: var(--spacing-sm); }
  .section-divider::after { flex: 1; }
  @media (max-width: 640px) {
    .section-links { display: flex; overflow-x: auto; }
    .property-nav.grouped { display: block; }
    .section-divider { margin-block: var(--spacing-xs); }
  }
</style>
