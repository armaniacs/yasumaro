<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value = '';
  export let placeholder = 'example.com\nanother.com';

  const dispatch = createEventDispatcher();

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    value = target.value;
    dispatch('change', { value });
  }
</script>

<textarea
  {value}
  {placeholder}
  on:input={handleInput}
  class="w-full h-32 px-3 py-2 border rounded font-mono text-sm resize-y"
  spellcheck="false"
></textarea>