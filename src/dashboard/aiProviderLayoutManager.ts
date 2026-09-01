/**
 * AIプロバイダ設定レイアウト管理
 * 各優先度レベルのプロバイダ設定を適切な優先度コンテナに配置
 * 元のDOMノードを移動することで、イベントリスナーと値の同期を保証
 */

import { providerIdsInOrder } from './aiProviderCatalogView.js';

/** Each provider's settings block is `#<providerId>Settings` in both layouts. */
function settingsDivId(providerId: string): string {
  return `${providerId}Settings`;
}

// 各プロバイダ設定divの元の親を保存（復元用）
const originalParents = new Map<string, HTMLElement>();

/**
 * プロバイダ設定divを優先度コンテナに移動
 * @param priorityLevel 優先度（1、2、3）
 * @param provider プロバイダID
 */
function moveProviderSettingsToPriority(priorityLevel: 1 | 2 | 3, provider: string | undefined): void {
  const containerSelector = `#priority${priorityLevel}ProviderSettings`;
  const container = document.querySelector(containerSelector) as HTMLElement;

  if (!container) return;
  if (!provider) return;
  if (!(providerIdsInOrder() as string[]).includes(provider)) return;

  const id = settingsDivId(provider);
  const settingsDiv = document.getElementById(id) as HTMLElement;
  if (!settingsDiv) return;

  if (!originalParents.has(id)) {
    const parent = settingsDiv.parentElement;
    if (parent) {
      originalParents.set(id, parent);
    }
  }

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
  providerIdsInOrder().forEach((providerId) => {
    const settingsDiv = document.getElementById(settingsDivId(providerId));
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
