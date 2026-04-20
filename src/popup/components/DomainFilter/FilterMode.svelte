<script lang="ts">
  import { createEvent } from 'svelte';

  let { value = 'disabled' } = $props<{
    value?: 'whitelist' | 'blacklist' | 'disabled';
  }>();

  const change = createEvent<{ value: 'whitelist' | 'blacklist' | 'disabled' }>();

  const modes = [
    { value: 'disabled', label: '無効 / Disabled' },
    { value: 'whitelist', label: '許可リスト / Whitelist' },
    { value: 'blacklist', label: 'ブロックリスト / Blacklist' }
  ] as const;

  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    value = target.value as typeof value;
    change({ value });
  }
</script>

<div class="flex flex-col gap-2">
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
