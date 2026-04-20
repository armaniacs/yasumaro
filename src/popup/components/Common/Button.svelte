<script>
  /** @type {'primary' | 'secondary' | 'danger'} */
  export let variant = 'primary';
  export let disabled = false;
  /** @type {'button' | 'submit' | 'reset'} */
  export let type = 'button';
  
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  };
</script>

<button
  {type}
  {disabled}
  class="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed {variantClasses[variant]}"
  on:click
>
  <slot />
</button>