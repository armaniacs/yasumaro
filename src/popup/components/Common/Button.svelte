<script lang="ts">
  let props = $props() as {
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    children?: any;
  };
  let { variant = 'primary', disabled = false, type = 'button', children } = props;

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  } as const;
</script>

<button
  {type}
  {disabled}
  class="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed {variantClasses[variant]}"
  onclick
>
  {@render children()}
</button>
