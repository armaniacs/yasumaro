/**
 * ollamaSettingsObserver.ts
 * OLLAMA_BASE_URL設定変更を監視し、declarativeNetRequestルールを同期するコールバックを生成する。
 *
 * service-worker.ts はcomposition rootで直接ユニットテストしづらいため、
 * settingsRepository.observe() に渡すコールバック本体をここに抽出してテスト可能にする。
 */
import { StorageKeys } from '../../utils/storage/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { logWarn } from '../../utils/logger.js';

export function createOllamaSettingsObserver(
  syncFn: (baseUrl: string) => Promise<void>,
): (changes: Partial<Settings>) => void {
  let prevOllamaBaseUrl: string | undefined;
  return (changes) => {
    const nextOllamaBaseUrl = changes[StorageKeys.OLLAMA_BASE_URL];
    if (nextOllamaBaseUrl === prevOllamaBaseUrl) return;
    prevOllamaBaseUrl = nextOllamaBaseUrl;
    if (nextOllamaBaseUrl === undefined) return;

    void syncFn(nextOllamaBaseUrl).catch((error) => {
      logWarn(
        'Ollama Origin header rule sync failed on settings change',
        { error: String(error) },
        undefined,
        'service-worker',
      );
    });
  };
}
