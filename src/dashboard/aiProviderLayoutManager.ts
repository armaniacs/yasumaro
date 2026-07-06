/**
 * AIプロバイダ設定レイアウト管理
 * 各優先度レベルのプロバイダ設定を適切な優先度コンテナに配置
 * 元のDOMノードを移動することで、イベントリスナーと値の同期を保証
 */

interface ProviderSettingsMap {
  gemini: { id: string; label: string };
  openai: { id: string; label: string };
  openai2: { id: string; label: string };
  'lm-studio': { id: string; label: string };
  ollama: { id: string; label: string };
  'openai-compatible': { id: string; label: string };
}

const PROVIDER_SETTINGS_MAP: ProviderSettingsMap = {
  gemini: { id: 'geminiSettings', label: 'Gemini' },
  openai: { id: 'openaiSettings', label: 'OpenAI' },
  openai2: { id: 'openai2Settings', label: 'OpenAI 2' },
  'lm-studio': { id: 'lm-studioSettings', label: 'LM Studio' },
  ollama: { id: 'ollamaSettings', label: 'Ollama' },
  'openai-compatible': { id: 'openai-compatibleSettings', label: 'OpenAI Compatible' }
};

// 各プロバイダ設定divの元の親を保存（復元用）
const originalParents = new Map<string, HTMLElement>();

/**
 * プロバイダ設定divを優先度コンテナに移動
 * @param priorityLevel 優先度（1、2、3）
 * @param provider プロバイダID
 */
function moveProviderSettingsToPriority(priorityLevel: 1 | 2 | 3, provider: string): void {
  const containerSelector = `#priority${priorityLevel}ProviderSettings`;
  const container = document.querySelector(containerSelector) as HTMLElement;

  if (!container) return;

  if (!provider) return;

  const providerInfo = PROVIDER_SETTINGS_MAP[provider as keyof ProviderSettingsMap];
  if (!providerInfo) return;

  const settingsDiv = document.getElementById(providerInfo.id) as HTMLElement;
  if (!settingsDiv) return;

  // 元の親を保存（まだ保存されていない場合）
  if (!originalParents.has(providerInfo.id)) {
    const parent = settingsDiv.parentElement;
    if (parent) {
      originalParents.set(providerInfo.id, parent);
    }
  }

  // 既に別の場所にある場合は移動
  settingsDiv.style.display = 'block';
  container.appendChild(settingsDiv);
}

/**
 * 全優先度レベルのプロバイダ設定レイアウトを更新
 * @param providers 各優先度のプロバイダID配列 [priority1, priority2, priority3]
 */
export function updateProviderSettingsLayout(providers: string[]): void {
  const [provider1, provider2, provider3] = providers;

  moveProviderSettingsToPriority(1, provider1);
  moveProviderSettingsToPriority(2, provider2);
  moveProviderSettingsToPriority(3, provider3);
}

/**
 * すべてのプロバイダ設定を非表示にする
 */
export function hideAllProviderSettings(): void {
  Object.values(PROVIDER_SETTINGS_MAP).forEach(({ id }) => {
    const settingsDiv = document.getElementById(id);
    if (settingsDiv) {
      settingsDiv.style.display = 'none';
    }
  });
}

/**
 * すべてのプロバイダ設定を元の親に戻す（クリーンアップ用）
 */
export function restoreOriginalProviderSettingsLayout(): void {
  originalParents.forEach((parent, id) => {
    const settingsDiv = document.getElementById(id);
    if (settingsDiv) {
      parent.appendChild(settingsDiv);
    }
  });
}
