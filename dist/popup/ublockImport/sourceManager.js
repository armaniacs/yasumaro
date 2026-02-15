/**
 * sourceManager.ts
 * uBlockインポートモジュール - ソース管理機能
 */
import { parseUblockFilterListWithErrors, isValidString } from '../../utils/ublockParser.js';
import { StorageKeys, saveSettings, getSettings } from '../../utils/storage.js';
import { showStatus } from '../settingsUiHelper.js';
import { rebuildRulesFromSources } from './rulesBuilder.js';
/**
 * 保存済みソース一覧を読み込んで表示
 */
export async function loadAndDisplaySources(renderCallback) {
    const settings = await getSettings();
    const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []);
    if (renderCallback) {
        renderCallback(sources);
    }
}
/**
 * ソースを削除
 * @param {number} index - 削除するソースのインデックス
 */
export async function deleteSource(index, renderCallback) {
    const settings = await getSettings();
    const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []);
    if (index < 0 || index >= sources.length)
        return;
    sources.splice(index, 1);
    // ルールを再構築
    const mergedRules = rebuildRulesFromSources(sources);
    await saveSettings({
        [StorageKeys.UBLOCK_SOURCES]: sources,
        [StorageKeys.UBLOCK_RULES]: mergedRules,
        [StorageKeys.UBLOCK_FORMAT_ENABLED]: sources.length > 0
    }, true);
    if (renderCallback) {
        renderCallback(sources);
    }
    showStatus('domainStatus', 'ソースを削除しました', 'success');
}
/**
 * ソースを再読み込み
 * @param {number} index - 再読み込みするソースのインデックス
 * @param {Function} fetchFromUrlCallback - URL読み込みコールバック
 * @returns {Promise<Object>} 更新結果
 */
export async function reloadSource(index, fetchFromUrlCallback) {
    const settings = await getSettings();
    const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []);
    if (index < 0 || index >= sources.length) {
        throw new Error('無効なインデックス');
    }
    const source = sources[index];
    if (source.url === 'manual') {
        throw new Error('手動入力のソースは更新できません');
    }
    const filterText = await fetchFromUrlCallback(source.url);
    // エラーチェック付きでパース
    const result = parseUblockFilterListWithErrors(filterText);
    const ruleCount = result.rules?.metadata?.ruleCount ?? 0;
    if (ruleCount === 0) {
        throw new Error('有効なルールが見つかりませんでした。更新を中止します。');
    }
    // エラーがあっても、有効なルールが存在すれば更新を許可
    if (result.errors.length > 0) {
        console.warn(`${result.errors.length}個のエラーがスキップされました（有効なルール: ${ruleCount}）`);
    }
    // ドメインリストのみを抽出（軽量化）
    const blockDomains = result.rules.blockRules.map((r) => r.domain);
    const exceptionDomains = result.rules.exceptionRules.map((r) => r.domain);
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
    await saveSettings({
        [StorageKeys.UBLOCK_SOURCES]: sources,
        [StorageKeys.UBLOCK_RULES]: mergedRules
    }, true);
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
export async function saveUblockSettings(text, url = null) {
    // 入力値検証: 空文字列は事前にチェック
    if (!isValidString(text)) {
        throw new Error('有効なルールが見つかりませんでした');
    }
    const result = parseUblockFilterListWithErrors(text);
    const ruleCount = result.rules?.metadata?.ruleCount ?? 0;
    if (ruleCount === 0) {
        showStatus('domainStatus', '有効なルールが見つかりませんでした', 'error');
        throw new Error('有効なルールが見つかりませんでした');
    }
    // エラーがあっても、有効なルールが存在すれば保存を許可
    // (localhost, broadcasthost等の特殊ドメインは意図的にスキップされる)
    if (result.errors.length > 0) {
        console.warn(`${result.errors.length}個のエラーがスキップされました（有効なルール: ${ruleCount}）`);
    }
    const settings = await getSettings();
    const sources = (settings[StorageKeys.UBLOCK_SOURCES] || []);
    const sourceUrl = url || 'manual';
    const existingIndex = sources.findIndex(s => s.url === sourceUrl);
    // ドメインリストのみを抽出（軽量化）
    const blockDomains = result.rules.blockRules.map((r) => r.domain);
    const exceptionDomains = result.rules.exceptionRules.map((r) => r.domain);
    const newSource = {
        url: sourceUrl,
        importedAt: Date.now(),
        ruleCount: ruleCount,
        blockDomains,
        exceptionDomains
    };
    if (existingIndex >= 0) {
        sources[existingIndex] = newSource;
    }
    else {
        sources.push(newSource);
    }
    // ルールを再構築
    const mergedRules = rebuildRulesFromSources(sources);
    await saveSettings({
        [StorageKeys.UBLOCK_SOURCES]: sources,
        [StorageKeys.UBLOCK_RULES]: mergedRules,
        [StorageKeys.UBLOCK_FORMAT_ENABLED]: true
    }, true);
    const action = existingIndex >= 0 ? '更新' : '追加';
    showStatus('domainStatus', `フィルターソースを${action}しました（${ruleCount}ルール）`, 'success');
    return {
        sources,
        action,
        ruleCount: ruleCount
    };
}
//# sourceMappingURL=sourceManager.js.map