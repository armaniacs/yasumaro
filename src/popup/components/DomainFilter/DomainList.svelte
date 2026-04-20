<script lang="ts">
  import { createEvent } from 'svelte';

  let { 
    value = '', 
    placeholder = 'example.com\nanother.com' 
  } = $props<{
    value?: string;
    placeholder?: string;
  }>();

  const change = createEvent<{ value: string }>();

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    value = target.value;
    change({ value });
  }
</script>

<textarea
  {value}
  {placeholder}
  oninput={handleInput}
  class="w-full h-32 px-3 py-2 border rounded font-mono text-sm resize-y"
  spellcheck="false"
></textarea>
