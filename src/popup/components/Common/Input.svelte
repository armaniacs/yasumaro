<script>
  export let type = 'text';
  export let id = '';
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
</script>

<input
  {type}
  {id}
  bind:value
  {placeholder}
  {disabled}
  class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
/>