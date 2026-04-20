<script lang="ts">
  import Button from './components/Common/Button.svelte';
  import Input from './components/Common/Input.svelte';
  import ProviderSelect from './components/Settings/ProviderSelect.svelte';
  import TabList from './components/Navigation/TabList.svelte';
  
  let activeTab = 'general';
  let aiProvider = 'gemini';
  
  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'domain', label: 'Domain' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'privacy', label: 'Privacy' }
  ];
  
  function handleProviderChange(event: CustomEvent<{ value: string }>) {
    aiProvider = event.detail.value;
  }
</script>

<div class="min-h-screen bg-gray-50">
  <TabList {tabs} bind:activeTab />
  
  <main class="p-4">
    {#if activeTab === 'general'}
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">Settings</h2>
        
        <ProviderSelect value={aiProvider} on:change={handleProviderChange} />
        
        <Input
          id="protocol"
          label="Protocol"
          value="http"
          placeholder="http or https"
        />
        
        <Input
          id="port"
          label="Port"
          type="number"
          value="27123"
          placeholder="27123"
        />
        
        <div class="pt-4">
          <Button variant="primary">Save</Button>
        </div>
      </div>
    {/if}
  </main>
</div>
