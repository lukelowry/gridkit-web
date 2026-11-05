<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import Popover from '../ui/Popover.svelte';
  let { globe, pitch, earth, ready, onproject }: {
    globe: boolean; pitch: number; earth: boolean; ready: boolean;
    onproject: (projection: 'flat' | 'tilt' | 'globe') => void;
  } = $props();
  const id = $props.id();
</script>

<button class="c-icon-btn" aria-label="Flat" title="Flat; select again to fit" aria-pressed={!globe && pitch < 1} disabled={!ready} onclick={() => onproject('flat')}><Icon name="projection-flat" /></button>
<button class="c-icon-btn" aria-label="Tilt" title="Tilt; select again to fit" aria-pressed={!globe && pitch >= 1} disabled={!ready} onclick={() => onproject('tilt')}><Icon name="projection-tilt" /></button>
{#if earth}
  <button class="c-icon-btn" aria-label="Globe" title="Globe; select again to fit" aria-pressed={globe} disabled={!ready} onclick={() => onproject('globe')}><Icon name="projection-globe" /></button>
{:else}
  <Popover label="Globe unavailable" width={256} align="end">
    {#snippet trigger(popup)}
      <button class="c-icon-btn unavailable" aria-label="Globe" aria-describedby={id} title="Why Globe is unavailable" aria-haspopup="dialog" popovertarget={popup}><Icon name="projection-globe" /></button>
    {/snippet}
    <p id={id}>Globe requires geographic bus coordinates. Update the source case with valid longitude and latitude to enable this projection.</p>
  </Popover>
{/if}

<style>
  .unavailable { color: var(--color-text-3); }
  p { margin: 0; padding: 8px; font: var(--type-compact); }
</style>
