<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value: 'whitelist' | 'blacklist' | 'disabled' = 'disabled';

  const dispatch = createEventDispatcher();

  const modes = [
    { value: 'disabled', label: '無効 / Disabled' },
    { value: 'whitelist', label: '許可リスト / Whitelist' },
    { value: 'blacklist', label: 'ブロックリスト / Blacklist' }
  ] as const;

  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    value = target.value as typeof value;
    dispatch('change', { value });
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
        on:change={handleChange}
        class="w-4 h-4"
      />
      <span>{mode.label}</span>
    </label>
  {/each}
</div>