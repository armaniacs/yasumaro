<script>
  export let variant = 'primary';
  export let disabled = false;
</script>

<button
  class="px-4 py-2 rounded {variant === 'primary' ? 'bg-blue-600 text-white' : 'bg-gray-200'}"
  {disabled}
  on:click
>
  <slot />
</button>