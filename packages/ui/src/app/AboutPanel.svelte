<script lang="ts">
  let { versions = {} }: { versions?: Readonly<Record<string, string | undefined>> } = $props();
  const sections = [
    { label: 'Application', components: ['GridKit Web', 'Latkit', 'Svelte'] },
    { label: 'Simulation engine', components: ['GridKit', 'SUNDIALS', 'KLU', 'SuiteSparse'] },
  ];
</script>

<section aria-label="About">
  <div class="property-heading"><h3>About</h3></div>
  <p class="description">Software specifications</p>
  {#each sections as section (section.label)}
    <table>
      <caption>{section.label}</caption>
      <thead><tr><th scope="col">Component</th><th scope="col">Version</th></tr></thead>
      <tbody>
        {#each section.components as name (name)}
          {@const version = versions[name]?.trim()}
          <tr><th scope="row">{name}</th><td class={{ untracked: !version }}>{version || 'Untracked'}</td></tr>
        {/each}
      </tbody>
    </table>
  {/each}
</section>

<style>
  .description { margin: 4px 0 16px; color: var(--color-text-2); }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  table + table { margin-top: 20px; }
  caption { padding-bottom: 8px; text-align: left; font: var(--type-title); }
  th, td { padding: 8px 0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  thead th { padding-block: 6px; border-bottom: 1px solid var(--color-border); color: var(--color-text-3); font: var(--type-caption); }
  th:first-child { width: 55%; padding-right: 16px; }
  tbody th { font-weight: 400; }
  tbody tr + tr { border-top: 1px solid var(--color-divider); }
  td, thead th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .untracked { color: var(--color-text-3); }
</style>
