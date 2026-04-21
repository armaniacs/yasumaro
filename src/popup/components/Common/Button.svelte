<script lang="ts">
  import type { Snippet } from 'svelte';
  
  let { 
    variant = 'primary', 
    disabled = false, 
    type = 'button',
    ariaLabel = '',
    onclick,
    children
  } = $props<{
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
    onclick?: () => void;
    children?: Snippet;
  }>();

  const variantClasses: Record<string, string> = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-600 hover:bg-red-700 text-white'
  };
</script>

<button
  {type}
  {disabled}
  aria-label={ariaLabel || undefined}
  class="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed {variantClasses[variant]}"
  {onclick}
>
  {#if children}
    {@render children()}
  {/if}
</button>
