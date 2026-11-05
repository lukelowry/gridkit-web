<script lang="ts">
  import { watchNotice, type Toast } from './toasts.svelte.js';
  let { message, action }: { message: string; action?: Toast['action'] } = $props();
  watchNotice(() => message, () => ({ action }));
</script>
