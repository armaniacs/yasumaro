<script lang="ts">
  let { value = $bindable('gemini') } = $props<{
    value?: string;
  }>();
  
  const providers = [
    { value: 'gemini', label: 'Gemini (Google AI)', baseUrl: 'https://generativelanguage.googleapis.com/' },
    { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/' },
    { value: 'openai2', label: 'OpenAI (Compatible)', baseUrl: '' }
  ];
</script>

<div class="flex flex-col gap-1">
  <label for="aiProvider" class="text-sm font-medium text-gray-700">AI Provider</label>
  
  <select
    id="aiProvider"
    bind:value
    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
    {#each providers as provider}
      <option value={provider.value}>{provider.label}</option>
    {/each}
  </select>
</div>