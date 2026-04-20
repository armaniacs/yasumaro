<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let value = 'gemini';
  
  const dispatch = createEventDispatcher();
  
  const providers = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'openai2', label: 'OpenAI (Compatible)' }
  ];
  
  function handleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    value = target.value;
    dispatch('change', { value });
  }
</script>

<select 
  id="aiProvider"
  {value}
  on:change={handleChange}
  class="w-full px-3 py-2 border rounded"
>
  {#each providers as provider}
    <option value={provider.value}>{provider.label}</option>
  {/each}
</select>