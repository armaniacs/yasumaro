/**
 * sourceManager.ts
 * uBlockインポートモジュール - ソース管理機能
 */

import { parseUblockFilterListWithErrors, isValidString } from '../../../utils/ublockParser/index.js';
import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { getMessageOr, getMessageWithSubstitutions } from '../../../utils/i18n.js';
import { logWarn } from '../../../utils/logger/api.js';
import { ErrorCode } from '../../../utils/logger/types.js';
import { rebuildRulesFromSources } from './rulesBuilder.js';
import type { Source } from '../../../utils/types.js';

interface ReloadResult {
  sources: Source[];
  ruleCount: number;
}

interface SaveResult {
  sources: Source[];
  action: string;
  ruleCount: number;
}

/**
 * Extract only the fields that storage consumers read from merged rules.
 * `blockRules`/`exceptionRules` are `string[]` in RebuiltRules but `UblockRule[]`
 * in UblockRules — storing them would require a type-unsafe cast. Consumers
 * prefer `blockDomains`/`exceptionDomains` when present, so we only persist those.
 */
function buildRulesPayload(mergedRules: ReturnType<typeof rebuildRulesFromSources>): {
  blockDomains: string[];
  exceptionDomains: string[];
  metadata: { importedAt: number; ruleCount: number };
} {
  return {
    blockDomains: mergedRules.blockDomains,
    exceptionDomains: mergedRules.exceptionDomains,
    metadata: mergedRules.metadata,
  };
}

/**
 * 保存済みソース一覧を読み込んで表示
 */
export async function loadAndDisplaySources(renderCallback?: (sources: Source[]) => void): Promise<void> {
  const settings = await settingsRepository.getAll();
  const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []) as Source[];
  if (renderCallback) {
    renderCallback(sources);
  }
}

/**
 * ソースを削除
 * @param {number} index - 削除するソースのインデックス
 */
export async function deleteSource(index: number, renderCallback?: (sources: Source[]) => void): Promise<void> {
  const settings = await settingsRepository.getAll();
  const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []) as Source[];

  if (index < 0 || index >= sources.length) return;

  sources.splice(index, 1);

  // ルールを再構築
  const mergedRules = rebuildRulesFromSources(sources);

  await settingsRepository.setAll({
    [StorageKeys.UBLOCK_SOURCES]: sources,
    [StorageKeys.UBLOCK_RULES]: buildRulesPayload(mergedRules),
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: sources.length > 0
  });

  if (renderCallback) {
    renderCallback(sources);
  }
  showStatus('domainStatus', getMessageOr('ublockSourceDeleted', 'ソースを削除しました'), 'success');
}

/**
 * ソースを再読み込み
 * @param {number} index - 再読み込みするソースのインデックス
 * @param {Function} fetchFromUrlCallback - URL読み込みコールバック
 * @returns {Promise<Object>} 更新結果
 */
export async function reloadSource(index: number, fetchFromUrlCallback: (url: string) => Promise<string>): Promise<ReloadResult> {
  const settings = await settingsRepository.getAll();
  const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []) as Source[];

  if (index < 0 || index >= sources.length) {
    throw new Error(getMessageOr('ublockInvalidIndex', '無効なインデックス'));
  }

  const source = sources[index];
  if (!source) throw new Error(getMessageOr('ublockInvalidIndex', '無効なインデックス'));
  if (source.url === 'manual') {
    throw new Error(getMessageOr('ublockManualSourceNotReloadable', '手動入力のソースは更新できません'));
  }

  const filterText = await fetchFromUrlCallback(source.url);

  // エラーチェック付きでパース
  const result = parseUblockFilterListWithErrors(filterText);

  const ruleCount = result.rules?.metadata?.ruleCount ?? 0;
  if (ruleCount === 0) {
    throw new Error(getMessageOr('ublockNoValidRulesAborted', 'エラーが見つかりました: 有効なルールが見つかりませんでした。更新を中止します。'));
  }

  // エラーがあっても、有効なルールが存在すれば更新を許可
  if (result.errors.length > 0) {
    void logWarn('uBlock source reload skipped invalid lines', { skipped: result.errors.length, ruleCount }, ErrorCode.SETTINGS_IMPORT_FAILURE, 'sourceManager');
  }

  // ドメインリストのみを抽出（軽量化）
  const blockDomains = (result.rules.blockRules ?? []).map(r => r.domain);
  const exceptionDomains = (result.rules.exceptionRules ?? []).map(r => r.domain);

  // ソース更新
  sources[index] = {
    ...source,
    importedAt: Date.now(),
    ruleCount: ruleCount,
    blockDomains,
    exceptionDomains
  };

  // ルールを再構築
  const mergedRules = rebuildRulesFromSources(sources);

  await settingsRepository.setAll({
    [StorageKeys.UBLOCK_SOURCES]: sources,
    [StorageKeys.UBLOCK_RULES]: buildRulesPayload(mergedRules)
  });

  return {
    sources,
    ruleCount: ruleCount
  };
}

/**
 * uBlock設定の保存（軽量化版）
 * @param {string} text - 保存するフィルターテキスト
 * @param {string|null} url - ソースURL（手動入力の場合はnull）
 */
export async function saveUblockSettings(text: string, url: string | null = null): Promise<SaveResult> {
  // 入力値検証: 空文字列は事前にチェック
  if (!isValidString(text)) {
    throw new Error(getMessageOr('ublockNoValidRules', '有効なルールが見つかりませんでした'));
  }

  const result = parseUblockFilterListWithErrors(text);

  const ruleCount = result.rules?.metadata?.ruleCount ?? 0;
  if (ruleCount === 0) {
    showStatus('domainStatus', getMessageOr('ublockNoValidRulesWithDetail', 'エラーが見つかりました: 有効なルールが見つかりませんでした'), 'error');
    throw new Error(getMessageOr('ublockNoValidRulesWithDetail', 'エラーが見つかりました: 有効なルールが見つかりませんでした'));
  }

  // エラーがあっても、有効なルールが存在すれば保存を許可
  // (localhost, broadcasthost等の特殊ドメインは意図的にスキップされる)
  if (result.errors.length > 0) {
    void logWarn('uBlock settings save skipped invalid lines', { skipped: result.errors.length, ruleCount }, ErrorCode.SETTINGS_IMPORT_FAILURE, 'sourceManager');
  }

  const settings = await settingsRepository.getAll();
  const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []) as Source[];

  const sourceUrl = url || 'manual';
  const existingIndex = sources.findIndex(s => s.url === sourceUrl);

  // ドメインリストのみを抽出（軽量化）
  const blockDomains = (result.rules.blockRules ?? []).map(r => r.domain);
  const exceptionDomains = (result.rules.exceptionRules ?? []).map(r => r.domain);

  const newSource: Source = {
    url: sourceUrl,
    importedAt: Date.now(),
    ruleCount: ruleCount,
    blockDomains,
    exceptionDomains
  };

  if (existingIndex >= 0) {
    sources[existingIndex] = newSource;
  } else {
    sources.push(newSource);
  }

  // ルールを再構築
  const mergedRules = rebuildRulesFromSources(sources);

  await settingsRepository.setAll({
    [StorageKeys.UBLOCK_SOURCES]: sources,
    [StorageKeys.UBLOCK_RULES]: buildRulesPayload(mergedRules),
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: true
  });

  const action = existingIndex >= 0 ? '更新' : '追加';
  showStatus('domainStatus', getMessageWithSubstitutions(
    existingIndex >= 0 ? 'ublockSourceSavedUpdated' : 'ublockSourceSavedAdded',
    { ruleCount },
    existingIndex >= 0 ? 'フィルターソースを更新しました（{ruleCount}ルール）' : 'フィルターソースを追加しました（{ruleCount}ルール）'
  ), 'success');

  return {
    sources,
    action,
    ruleCount: ruleCount
  };
}