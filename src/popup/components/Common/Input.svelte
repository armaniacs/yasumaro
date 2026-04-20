<script>
  export let type = 'text';
  export let id = '';
  export let name = '';
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let required = false;
  
  export let label = '';
  export let error = '';
</script>

<div class="flex flex-col gap-1">
  {#if label}
    <label for={id} class="text-sm font-medium text-gray-700">{label}</label>
  {/if}
  
  <input
    {type}
    {id}
    {name}
    bind:value
    {placeholder}
    {disabled}
    {required}
    class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed {error ? 'border-red-500' : 'border-gray-300'}"
  />
  
  {#if error}
    <span class="text-sm text-red-500">{error}</span>
  {/if}
</div>