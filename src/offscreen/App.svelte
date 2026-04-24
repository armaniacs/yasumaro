<script lang="ts">
  import { onMount } from 'svelte';

  onMount(() => {
    console.log('Offscreen document initialized');
  });
</script>

<div class="p-4">
  <h1 class="text-lg font-semibold">Obsidian Weave</h1>
  <p class="text-sm text-gray-600">Offscreen document ready</p>
</div>