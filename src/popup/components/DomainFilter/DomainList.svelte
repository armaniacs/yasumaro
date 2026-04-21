<script lang="ts">
  let { 
    value = $bindable(''),
    placeholder = 'example.com\nanother.com',
    ariaLabel = 'Domain list',
    onchange
  } = $props<{
    value?: string;
    placeholder?: string;
    ariaLabel?: string;
    onchange?: (event: CustomEvent<{ value: string }>) => void;
  }>();

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    value = target.value;
    if (onchange) {
      onchange(new CustomEvent('change', { detail: { value: target.value } }) as unknown as CustomEvent<{ value: string }>);
    }
  }
</script>

<textarea
  {value}
  {placeholder}
  aria-label={ariaLabel}
  oninput={handleInput}
  class="w-full h-32 px-3 py-2 border rounded font-mono text-sm resize-y"
  spellcheck="false"
></textarea>
