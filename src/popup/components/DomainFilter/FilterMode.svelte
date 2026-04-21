<script lang="ts">
  let { 
    value = $bindable<'disabled' | 'whitelist' | 'blacklist'>('disabled'),
    onchange
  } = $props<{
    value?: 'disabled' | 'whitelist' | 'blacklist';
    onchange?: (event: CustomEvent<{ value: 'disabled' | 'whitelist' | 'blacklist' }>) => void;
  }>();

  const modes = [
    { value: 'disabled', label: '無効 / Disabled' },
    { value: 'whitelist', label: '許可リスト / Whitelist' },
    { value: 'blacklist', label: 'ブロックリスト / Blacklist' }
  ] as const;

  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const newValue = target.value as 'disabled' | 'whitelist' | 'blacklist';
    value = newValue;
    if (onchange) {
      onchange(new CustomEvent('change', { detail: { value: newValue } }) as unknown as CustomEvent<{ value: 'disabled' | 'whitelist' | 'blacklist' }>);
    }
  }
</script>

<div role="radiogroup" aria-label="Domain filter mode" class="flex flex-col gap-2">
  {#each modes as mode}
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="filterMode"
        value={mode.value}
        checked={value === mode.value}
        onchange={handleChange}
        class="w-4 h-4"
      />
      <span>{mode.label}</span>
    </label>
  {/each}
</div>
