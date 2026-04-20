<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let tabs: { id: string; label: string }[] = [];
  export let activeTab = '';

  const dispatch = createEventDispatcher();

  function selectTab(id: string) {
    activeTab = id;
    dispatch('change', { id });
  }
</script>

<nav class="flex border-b border-gray-200">
  {#each tabs as tab}
    <button
      class="px-4 py-2 text-sm font-medium transition-colors"
      class:text-blue-600={activeTab === tab.id}
      class:border-b-2={activeTab === tab.id}
      class:border-blue-600={activeTab === tab.id}
      class:text-gray-500={activeTab !== tab.id}
      on:click={() => selectTab(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>