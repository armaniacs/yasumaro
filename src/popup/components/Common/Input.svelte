<script lang="ts">
  let { 
    type = 'text',
    id = '',
    name = '',
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    required = false,
    label = '',
    error = ''
  } = $props<{
    type?: string;
    id?: string;
    name?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    label?: string;
    error?: string;
  }>();

  const errorId = error ? `${id}-error` : undefined;
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
    aria-invalid={error ? 'true' : 'false'}
    aria-describedby={errorId}
    class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed {error ? 'border-red-500' : 'border-gray-300'}"
  />
  
  {#if error}
    <span id={errorId} class="text-sm text-red-500" role="alert">{error}</span>
  {/if}
</div>
