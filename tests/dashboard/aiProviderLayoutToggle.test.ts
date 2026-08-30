import { describe, it, expect } from 'vitest';

// InMemoryStoragePort を使った簡易テスト
import { InMemoryStoragePort } from '../../src/utils/storage/InMemoryStoragePort.js';
import { SettingsRepository } from '../../src/utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../src/utils/storage/types.js';
import { resolveInitialLayout } from '../../src/dashboard/aiProviderLayoutToggle.js';

describe('resolveInitialLayout', () => {
  it('新規ユーザー（onboarding未完了かつpriorityList空）は b', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    // 直接 port に seed（repo.set は DEFAULT_SETTINGS を全て永続化して AI_PROVIDER_LAYOUT='a' を作ってしまうため）
    await port.set({
      settings: {
        [StorageKeys.ONBOARDING_WIZARD_COMPLETED]: false,
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [],
      },
    });
    const layout = await resolveInitialLayout(repo);
    expect(layout).toBe('b');
  });
  it('既存ユーザー（onboarding完了）は a', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    await port.set({
      settings: {
        [StorageKeys.ONBOARDING_WIZARD_COMPLETED]: true,
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai' }],
      },
    });
    const layout = await resolveInitialLayout(repo);
    expect(layout).toBe('a');
  });
  it('既に保存済みなら保存値を尊重（上書きしない）', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    await repo.set(StorageKeys.AI_PROVIDER_LAYOUT, 'b');
    await repo.set(StorageKeys.ONBOARDING_WIZARD_COMPLETED, true);
    const layout = await resolveInitialLayout(repo);
    expect(layout).toBe('b');
  });
});
