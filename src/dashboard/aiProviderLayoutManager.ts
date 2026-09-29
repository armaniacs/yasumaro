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
 *
 * 復元に続けて記録を捨てる: この Map は HTMLElement を保持する唯一の所有者で、
 * 破棄経路がないと、破棄済み document のノードが代わる再 mount のたびに
 * 古い親要素への参照が残り続ける。記録を消すと次の移動は「その時点で实际的
 * な親」を覚えて、A→B→A 切替（generalSettingsPanel.refreshAIProviderLayout）が
 * 一度破棄したブロックではなく現在の配置基準に戻す。
 */
export function restoreOriginalProviderSettingsLayout(): void {
  originalParents.forEach((parent, id) => {
    const settingsDiv = document.getElementById(id);
    if (settingsDiv) {
      parent.appendChild(settingsDiv);
    }
  });
  originalParents.clear();
}
