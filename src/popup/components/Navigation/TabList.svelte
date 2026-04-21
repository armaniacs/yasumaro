<script lang="ts">
  let { 
    tabs = $bindable([]), 
    activeTab = $bindable('') 
  } = $props<{
    tabs?: { id: string; label: string }[];
    activeTab?: string;
  }>();

  function selectTab(id: string) {
    activeTab = id;
  }
</script>

<nav role="tablist" aria-label="Settings tabs" class="flex border-b border-gray-200">
  {#each tabs as tab}
    <button
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls="{tab.id}Panel"
      id="{tab.id}Tab"
      tabindex={activeTab === tab.id ? 0 : -1}
      class="px-4 py-2 text-sm font-medium transition-colors"
      class:text-blue-600={activeTab === tab.id}
      class:border-b-2={activeTab === tab.id}
      class:border-blue-600={activeTab === tab.id}
      class:text-gray-500={activeTab !== tab.id}
      onclick={() => selectTab(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>
