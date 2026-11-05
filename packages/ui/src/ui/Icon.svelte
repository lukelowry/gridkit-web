<script lang="ts">
  import { glyphs, type IconName } from './icons.js';
  let { name }: { name: IconName } = $props();
</script>

<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each glyphs[name] as shape, index (index)}
    {#if typeof shape === 'string'}<path d={shape} />
    {:else}<circle cx={shape[0]} cy={shape[1]} r={shape[2]} />{/if}
  {/each}
</svg>
