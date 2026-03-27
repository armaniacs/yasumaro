// src/background/recordingLogic.ts
import { PrivacyPipeline, PrivacyPipelineOptions, PrivacyPipelineResult } from './privacyPipeline.js';
import { NotificationHelper } from './notificationHelper.js';
import { addLog, LogType } from '../utils/logger.js';
import { isDomainAllowed, isDomainInList, extractDomain } from '../utils/domainUtils.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { getSettings, StorageKeys, getSavedUrlsWithTimestamps, setSavedUrlsWithTimestamps, saveSettings, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD, Settings } from '../utils/storage.js';
import { setUrlRecordType, setUrlMaskedCount, setUrlTags, setUrlContent, setUrlAiSummary, setUrlSentTokens, setUrlReceivedTokens, setUrlOriginalTokens, setUrlCleansedTokens, setUrlPageBytes, setUrlCandidateBytes, setUrlOriginalBytes, setUrlCleansedBytes, setUrlAiSummaryOriginalBytes, setUrlAiSummaryCleansedBytes, setUrlAiSummaryCleansedElements, setUrlAiSummaryCleansedReason } from '../utils/storageUrls.js';
import type { RecordType } from '../utils/storageUrls.js';
import { getUserLocale } from '../utils/localeUtils.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { sanitizeUrlForLogging } from '../utils/urlUtils.js';
import { isPrivateIpAddress } from '../utils/fetch.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { addPendingPage, PendingPage } from '../utils/pendingStorage.js';
// P0: host_permissions チェック（Top 1000プリセット + 拒否記録）
import { getPermissionManager } from '../utils/permissionManager.js';

// Trust domain checker（3段階警告）
import { TrustChecker } from '../utils/trustChecker.js';

// RecordingResult, MaskedItem 型 - messaging/types.tsからインポート
import type { RecordingResult, MaskedItem } from '../messaging/types.js';

// 【設定定数】設定キャッシュの有効期限（秒）🟢
// 【調整可能性】設定変更の頻度に応じて調整可能
const SETTINGS_CACHE_TTL = 30 * 1000; // 30 seconds

// 【設定定数】URLキャッシュの有効期限（秒 - Problem #7用）🟢
// 【調整可能性】重複チェックの許容スパンに応じて調整可能
const URL_CACHE_TTL = 60 * 1000; // 60 seconds

// 【設定定数】記録時の最大コンテンツサイズ（バイト）最大コンテンツサイズ 🟢
// 【PII保護】64KB以降のPIIはAI APIに送信されず、安全側の挙動
// 【設定理由】パフォーマンス: 大きなページがパイプラインをハングさせるのを防ぐ
// 【設定理由】コスト削減: AI APIへの転送データ量を制限
const MAX_RECORD_SIZE = 64 * 1024; // 64KB

// 【ヘルパー関数】コンテンツを最大サイズに切り詰める
// 【機能】指定された最大サイズを超えるコンテンツを安全に切り詰める
// 【PII保護】切り詰められたコンテンツのみがAI APIに送信される
// 【再利用性】テストやその他のコンテキストで独立して使用可能 🟢
// 【単一責任】コンテンツのサイズ制御のみを担当
// @param {string} content - 切り詰め対象のコンテンツ
// @param {number} maxSize - 最大サイズのバイト数（デフォルト: MAX_RECORD_SIZE）
// @returns {string} 切り詰められたコンテンツ（元のサイズ以下の場合はそのまま）
// @see PII_FEATURE_GUIDE.md - コンテンツサイズ制限の詳細
export function truncateContentSize(content: string, maxSize: number = MAX_RECORD_SIZE): string {
  // 【修正】TextEncoderを使用して正確なUTF-8バイト数を計算
  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);

  // バイト数が制限以内ならそのまま返す
  if (encoded.length <= maxSize) {
    return content;
  }

  // 【処理】バイト単位で切り詰め、文字列にデコード
  // 【注意】マルチバイト文字の途中で切らないよう、TextDecoderで処理
  const truncated = encoded.slice(0, maxSize);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(truncated);
}

/**
 * SSRF保護: フェッチ操作に安全なURLか検証
 * 【目的】SSRF攻撃に対する保護
 * @param {string} url - 検証するURL
 * @returns {boolean} 安全なURLの場合はtrue
 */
function isValidFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // 非HTTP(S)プロトコルを拒否
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // localhostおよびループバックアドレスを拒否
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || isPrivateIpAddress(hostname)) {
      return false;
    }

    // .internal, .local などの特殊ドメインを拒否
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

interface CacheState {
  settingsCache: Settings | null;
  cacheTimestamp: number | null;
  cacheVersion: number;
  urlCache: Map<string, number> | null;
  urlCacheTimestamp: number | null;
  privacyCache: Map<string, PrivacyInfo> | null;
  privacyCacheTimestamp: number | null;
}

export interface RecordingData {
  title: string;
  url: string;
  content: string;
  force?: boolean;
  skipDuplicateCheck?: boolean;
  alreadyProcessed?: boolean;
  previewOnly?: boolean;
  requireConfirmation?: boolean;
  headerValue?: string;
  recordType?: RecordType;
  maskedCount?: number;
  skipAi?: boolean;
  pageBytes?: number;       // findMainContentCandidates() 前のバイト数
  candidateBytes?: number;  // findMainContentCandidates() 後のバイト数
  originalBytes?: number;   // クレンジング前のバイト数
  cleansedBytes?: number;   // クレンジング後のバイト数
  aiSummaryOriginalBytes?: number;  // AI要約クレンジング前のバイト数
  aiSummaryCleansedBytes?: number;  // AI要約クレンジング後のバイト数
  aiSummaryCleansedElements?: number;  // AI要約クレンジングで削除した要素数
  aiSummaryCleansedReason?: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';  // AI要約クレンジング実行理由
  precomputedMaskedCount?: number;  // alreadyProcessed時に呼び元から渡されるマスク件数
}

export class RecordingLogic {
  // キャッシュ状態永続化（SERVICE-WORKER再起動間で保持）
  // Problem #3: 2重キャッシュ構造を1段階に簡素化 - staticキャッシュのみ使用
  // Problem #7: URLキャッシュも追加
  static cacheState: CacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null,
    privacyCache: null,
    privacyCacheTimestamp: null
  };

  private obsidian: ObsidianClient;
  private aiClient: AIClient;
  private mode: string | null;

  constructor(obsidianClient: ObsidianClient, aiClient: AIClient, privacyPipeline?: PrivacyPipeline | null) {
    this.obsidian = obsidianClient;
    this.aiClient = aiClient;
    // Problem #3: 2重キャッシュ構造を1段階に簡素化 - インスタンスキャッシュを削除
    // Code Review #1: this.modeの初期化（初期値はnull、record()で設定取得後に更新）
    this.mode = null;
  }

  /**
   * コンテンツを必要に応じて切り詰める
   */
  private _truncateContentIfNeeded(content: string): string {
    if (content) {
      const encoder = new TextEncoder();
      const contentBytes = encoder.encode(content).length;
      if (contentBytes > MAX_RECORD_SIZE) {
        const originalBytes = contentBytes;
        const truncatedContent = truncateContentSize(content);
        addLog(LogType.WARN, 'Content truncated for recording', {
          originalBytes,
          truncatedBytes: MAX_RECORD_SIZE
        });
        return truncatedContent;
      }
    }
    return content;
  }

  /**
   * ドメインフィルターをチェックする
   */
  private async _checkDomainFilter(url: string): Promise<boolean> {
    const isAllowed = await isDomainAllowed(url);
    return isAllowed;
  }

  /**
   * 権限をチェックする
   */
  private async _checkPermission(url: string): Promise<boolean> {
    const permissionManager = getPermissionManager();
    const permitted = await permissionManager.isHostPermitted(url);
    if (!permitted) {
      // 権限なし → 記録ブロック + 拒否記録
      let domain: string;
      try {
        domain = extractDomain(url) || new URL(url).hostname;
      } catch {
        addLog(LogType.ERROR, 'Failed to extract domain from URL', { url });
        return false;
      }
      await permissionManager.recordDeniedVisit(domain);
      addLog(LogType.WARN, 'Permission required for recording', { url, domain });
      return false;
    }
    return true;
  }

  /**
   * Trustドメインをチェックする
   */
  private async _checkTrustDomain(url: string, force: boolean): Promise<any> {
    const trustChecker = new TrustChecker();
    const trustCheck = await trustChecker.checkDomain(url);
    return trustCheck;
  }

  /**
   * プライバシーヘッダーをチェックする
   */
  private async _checkPrivacyHeaders(url: string, force: boolean, requireConfirmation: boolean, settings: Settings, headerValue: string): Promise<{ canProceed: boolean; result?: any } | null> {
    const privacyInfo = await this.getPrivacyInfoWithCache(url);
    if (privacyInfo?.isPrivate && !force) {
      addLog(LogType.WARN, 'Private page detected', {
        url,
        reason: privacyInfo.reason,
        requireConfirmation
      });

      // requireConfirmationの場合（手動保存）、pendingに保存してconfirmationRequired=trueを返す
      if (requireConfirmation) {
        // privacyInfo.headersから適切なヘッダー値を抽出、なければRecordingData.headerValueを使用
        const reason = privacyInfo.reason || 'cache-control';
        const actualHeaderValue = headerValue ||
          (reason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');
        await this._savePendingPage(url, '', reason, actualHeaderValue); // titleは後で取得
        return {
          canProceed: false,
          result: {
            success: false,
            error: 'PRIVATE_PAGE_DETECTED',
            reason: privacyInfo.reason,
            confirmationRequired: true
          }
        };
      }

      // 自動記録の場合：AUTO_SAVE_PRIVACY_BEHAVIOR 設定に応じた処理
      const autoSaveBehavior = settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save';
      const autoReason = privacyInfo.reason || 'cache-control';
      const autoHeaderValue = headerValue ||
        (autoReason === 'cache-control' ? privacyInfo.headers?.cacheControl || '' : '');

      if (autoSaveBehavior === 'skip') {
        // スキップ：pendingに保存して終了（ユーザーが後で記録履歴から登録できる）
        await this._savePendingPage(url, '', autoReason, autoHeaderValue); // titleは後で取得
        return {
          canProceed: false,
          result: {
            success: false,
            error: 'PRIVATE_PAGE_DETECTED',
            reason: privacyInfo.reason
          }
        };
      } else if (autoSaveBehavior === 'confirm') {
        // 確認：pendingに保存してconfirmationRequired=trueを返す
        await this._savePendingPage(url, '', autoReason, autoHeaderValue); // titleは後で取得
        return {
          canProceed: false,
          result: {
            success: false,
            error: 'PRIVATE_PAGE_DETECTED',
            reason: privacyInfo.reason,
            confirmationRequired: true,
            headerValue: autoHeaderValue
          }
        };
      }

      // 'save'（デフォルト）: そのまま続行して保存する
      addLog(LogType.INFO, 'Auto-saving private page (behavior=save)', { url });
    }

    if (privacyInfo?.isPrivate && force) {
      addLog(LogType.WARN, 'Force recording private page', {
        url,
        reason: privacyInfo.reason
      });
    }

    return { canProceed: true };
  }

  /**
   * 重複をチェックする
   */
  private async _checkDuplicates(url: string, skipDuplicateCheck: boolean): Promise<{ canProceed: boolean; result?: any; urlMap?: Map<string, number> } | null> {
    // 日付ベース重複チェック: Map<URL, timestamp> を取得
    const urlMap = await this.getSavedUrlsWithCache();

    // 同じURLが保存済みで、かつ同日の場合はスキップ（UTCベースで比較）
    if (!skipDuplicateCheck) {
      const savedTimestamp = urlMap.get(url);
      if (savedTimestamp) {
        const savedDate = new Date(savedTimestamp);
        const today = new Date();
        // UTCベースで同日かどうか判定（タイムゾーンの影響を受けない）
        if (savedDate.getUTCFullYear() === today.getUTCFullYear() &&
          savedDate.getUTCMonth() === today.getUTCMonth() &&
          savedDate.getUTCDate() === today.getUTCDate()) {
          addLog(LogType.DEBUG, 'Duplicate URL skipped (same day)', { url, savedDate: savedDate.toUTCString() });
          return {
            canProceed: false,
            result: { success: true, skipped: true, reason: 'same_day' }
          };
        }
        // 別日なら古いエントリを上書き（以降の処理で追加される）
      }
    }

    // Problem #4: URLセットサイズ制限チェック
    if (urlMap.size >= MAX_URL_SET_SIZE) {
      addLog(LogType.ERROR, 'URL set size limit exceeded', {
        current: urlMap.size,
        max: MAX_URL_SET_SIZE,
        url
      });
      NotificationHelper.notifyError(`URL history limit reached. Maximum ${MAX_URL_SET_SIZE} URLs (7-day retention) allowed. Please clear your history.`);
      return {
        canProceed: false,
        result: { success: false, error: 'URL set size limit exceeded. Please clear your history.' }
      };
    }

    // Problem #4: 警告閾値チェック
    if (urlMap.size >= URL_WARNING_THRESHOLD) {
      addLog(LogType.WARN, 'URL set size approaching limit', {
        current: urlMap.size,
        threshold: URL_WARNING_THRESHOLD,
        remaining: MAX_URL_SET_SIZE - urlMap.size
      });
    }

    return { canProceed: true, urlMap };
  }

  /**
   * Markdownをフォーマットする
   */
  private _formatMarkdown(title: string, url: string, summary: string): string {
    // P1: XSS対策 - summaryをサニタイズ（Markdownリンクのエスケープ）
    const sanitizedSummary = sanitizeForObsidian(summary);
    const sanitizedTitle = sanitizeForObsidian(title);
    const timestamp = new Date().toLocaleTimeString(getUserLocale(), { hour: '2-digit', minute: '2-digit' });
    return `- ${timestamp} [${sanitizedTitle}](${url})\n    - AI要約: ${sanitizedSummary}`;
  }

  /**
   * Obsidianに保存する
   */
  private async _saveToObsidian(markdown: string, title: string, url: string): Promise<void> {
    await this.obsidian.appendToDailyNote(markdown);
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url });
  }

  /**
   * メタデータを保存する
   */
  private async _saveMetadata(data: RecordingData, pipelineResult: PrivacyPipelineResult, urlMap?: Map<string, number>): Promise<void> {
    const {
      title, url, content, recordType, precomputedMaskedCount,
      pageBytes, candidateBytes, originalBytes, cleansedBytes,
      aiSummaryOriginalBytes, aiSummaryCleansedBytes, aiSummaryCleansedElements, aiSummaryCleansedReason
    } = data;

    // 記録方式をエントリに保存
    const resolvedRecordType: RecordType = recordType ?? 'auto';
    await setUrlRecordType(url, resolvedRecordType);

    // マスク件数を保存（alreadyProcessed の場合は呼び元から渡された値を優先）
    const resolvedMaskedCount = precomputedMaskedCount ?? pipelineResult.maskedCount ?? 0;
    if (resolvedMaskedCount > 0) {
      await setUrlMaskedCount(url, resolvedMaskedCount);
    }

    // コンテンツを記録履歴に保存
    if (content) {
      await setUrlContent(url, content);
    }

    // タグを保存（タグ付き要約モード時）
    if (pipelineResult.tags && pipelineResult.tags.length > 0) {
      await setUrlTags(url, pipelineResult.tags);
      addLog(LogType.INFO, 'Tags saved', { url, tags: pipelineResult.tags });
    }

    // AI要約を保存
    if (pipelineResult.summary) {
      await setUrlAiSummary(url, pipelineResult.summary);
      addLog(LogType.INFO, 'AI summary saved', { url });
    }

    // トークン数を保存
    if (pipelineResult.sentTokens !== undefined) {
      await setUrlSentTokens(url, pipelineResult.sentTokens);
      addLog(LogType.INFO, 'Sent tokens saved', { url, sentTokens: pipelineResult.sentTokens });
    }

    if (pipelineResult.receivedTokens !== undefined) {
      await setUrlReceivedTokens(url, pipelineResult.receivedTokens);
      addLog(LogType.INFO, 'Received tokens saved', { url, receivedTokens: pipelineResult.receivedTokens });
    }

    // 元のトークン数を保存
    if (pipelineResult.originalTokens !== undefined) {
      await setUrlOriginalTokens(url, pipelineResult.originalTokens);
      addLog(LogType.INFO, 'Original tokens saved', { url, originalTokens: pipelineResult.originalTokens });
    }

    // クレンジング後のトークン数を保存
    if (pipelineResult.cleansedTokens !== undefined) {
      await setUrlCleansedTokens(url, pipelineResult.cleansedTokens);
      addLog(LogType.INFO, 'Cleansed tokens saved', { url, cleansedTokens: pipelineResult.cleansedTokens });
    }

    // ページ全体のバイト数を保存（findMainContentCandidates() 前）
    if (pageBytes !== undefined) {
      await setUrlPageBytes(url, pageBytes);
    }

    // 候補要素のバイト数を保存（findMainContentCandidates() 後）
    if (candidateBytes !== undefined) {
      await setUrlCandidateBytes(url, candidateBytes);
    }

    // 元のバイト数を保存（Content Cleansingの前後）
    if (originalBytes !== undefined) {
      await setUrlOriginalBytes(url, originalBytes);
      addLog(LogType.INFO, 'Original bytes saved', { url, originalBytes });
    }

    // クレンジング後のバイト数を保存（Content Cleansingの前後）
    if (cleansedBytes !== undefined) {
      await setUrlCleansedBytes(url, cleansedBytes);
      addLog(LogType.INFO, 'Cleansed bytes saved', { url, cleansedBytes });
    }

    // AI要約クレンジング前のバイト数を保存
    if (aiSummaryOriginalBytes !== undefined) {
      await setUrlAiSummaryOriginalBytes(url, aiSummaryOriginalBytes);
      addLog(LogType.INFO, 'AI summary original bytes saved', { url, aiSummaryOriginalBytes });
    }

    // AI要約クレンジング後のバイト数を保存
    if (aiSummaryCleansedBytes !== undefined) {
      await setUrlAiSummaryCleansedBytes(url, aiSummaryCleansedBytes);
      addLog(LogType.INFO, 'AI summary cleansed bytes saved', { url, aiSummaryCleansedBytes });
    }

    // AI要約クレンジングで削除した要素数を保存
    if (aiSummaryCleansedElements !== undefined) {
      await setUrlAiSummaryCleansedElements(url, aiSummaryCleansedElements);
      addLog(LogType.INFO, 'AI summary cleansed elements saved', { url, aiSummaryCleansedElements });
    }

    // AI要約クレンジング実行理由を保存
    if (aiSummaryCleansedReason !== undefined) {
      await setUrlAiSummaryCleansedReason(url, aiSummaryCleansedReason);
      addLog(LogType.INFO, 'AI summary cleansed reason saved', { url, aiSummaryCleansedReason });
    }

    // Problem #7: URLキャッシュを無効化
    RecordingLogic.invalidateUrlCache();
  }

  /**
   * 設定キャッシュから取得する
   * Problem #3: 2重キャッシュ構造を1段階に簡素化
   */
  async getSettingsWithCache(): Promise<Settings> {
    const now = Date.now();

    // staticキャッシュを確認
    if (RecordingLogic.cacheState.settingsCache && RecordingLogic.cacheState.cacheTimestamp) {
      const age = now - RecordingLogic.cacheState.cacheTimestamp;
      if (age < SETTINGS_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Settings cache hit', { age: age + 'ms' });
        return RecordingLogic.cacheState.settingsCache;
      }
    }

    // キャッシュが無効な場合、storageから取得
    return this._fetchAndCacheSettings(now);
  }

  /**
   * storageから設定を取得しキャッシュに保存
   * Problem #3: 2重キャッシュ構造を1段階に簡素化
   */
  async _fetchAndCacheSettings(now: number): Promise<Settings> {
    const settings = await getSettings();

    // staticキャッシュのみに保存（Problem #3: 簡素化）
    RecordingLogic.cacheState.settingsCache = settings;
    RecordingLogic.cacheState.cacheTimestamp = now;
    RecordingLogic.cacheState.cacheVersion++;

    addLog(LogType.DEBUG, 'Settings cache updated', { cacheVersion: RecordingLogic.cacheState.cacheVersion });

    return settings;
  }

  /**
   * 設定キャッシュを無効化する
   * 設定が変更された場合に呼び出す
   */
  static invalidateSettingsCache(): void {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    RecordingLogic.cacheState.settingsCache = null;
    RecordingLogic.cacheState.cacheTimestamp = null;
    RecordingLogic.cacheState.cacheVersion++;
  }

  /**
   * インスタンスキャッシュを無効化する
   * Problem #3: 2重キャッシュを1段階に簡素化したためno-op
   */
  invalidateInstanceCache(): void {
    // 何もしない - 簡素化により不要になったメソッド
    addLog(LogType.DEBUG, 'invalidateInstanceCache called (no-op after simplification)');
  }

  /**
   * URLキャッシュから保存済みURLを取得する（日付ベース重複チェック用）
   * Map<string, number> (URL -> timestamp) を返す
   */
  async getSavedUrlsWithCache(): Promise<Map<string, number>> {
    const now = Date.now();

    // URLキャッシュを確認
    if (RecordingLogic.cacheState.urlCache && RecordingLogic.cacheState.urlCacheTimestamp) {
      const age = now - RecordingLogic.cacheState.urlCacheTimestamp;
      if (age < URL_CACHE_TTL) {
        addLog(LogType.DEBUG, 'URL cache hit', { count: RecordingLogic.cacheState.urlCache.size, age: age + 'ms' });
      // キャッシュの直接参照を返す
      // 注: この関数の呼び出し元はurlMapを変更してストレージに保存するため、
      // キャッシュは処理後にinvalidateUrlCache()で無効化される
      return RecordingLogic.cacheState.urlCache;
      }
    }

    // キャッシュが無効な場合、storageから取得（タイムスタンプ付き）
    const urlMap = await getSavedUrlsWithTimestamps();
    RecordingLogic.cacheState.urlCache = new Map(urlMap);
    RecordingLogic.cacheState.urlCacheTimestamp = now;

    addLog(LogType.DEBUG, 'URL cache updated', { count: urlMap.size });

    return urlMap;
  }

  /**
   * URLキャッシュを無効化する
   * Problem #7: URLキャッシュ追加に伴う無効化メソッド
   */
  static invalidateUrlCache(): void {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    RecordingLogic.cacheState.urlCache = null;
    RecordingLogic.cacheState.urlCacheTimestamp = null;
  }

  /**
   * HeaderDetector と同じ正規化ロジックでURLを正規化する
   * キャッシュキーの一貫性を保つために必要
   */
  private static normalizeUrlForCache(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/') && parsed.pathname !== '/') {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }

  /**
   * URLのプライバシー情報をキャッシュから取得する
   * TTL: 5分
   * Note: HeaderDetector と同じ normalizeUrl ロジックでキャッシュキーを正規化する
   */
  public async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    const now = Date.now();
    const PRIVACY_CACHE_TTL = 5 * 60 * 1000; // 5分

    // HeaderDetectorと同じ正規化でキャッシュキーを統一
    const normalizedUrl = RecordingLogic.normalizeUrlForCache(url);

    if (RecordingLogic.cacheState.privacyCache) {
      const cached = RecordingLogic.cacheState.privacyCache.get(normalizedUrl);
      if (cached && (now - cached.timestamp) < PRIVACY_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Privacy cache hit', { url });
        return cached;
      }
    }

    // キャッシュミス: Service Worker 再起動でインメモリキャッシュが消えた可能性がある
    // session storage からフォールバック取得を試みる
    if (chrome.storage.session) {
      try {
        const sessionKey = 'privacyCache_' + normalizedUrl;
        const result = await chrome.storage.session.get(sessionKey);
        const cached = result[sessionKey] as PrivacyInfo | undefined;
        if (cached) {
          // インメモリキャッシュに復元
          if (!RecordingLogic.cacheState.privacyCache) {
            RecordingLogic.cacheState.privacyCache = new Map();
            RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();
          }
          RecordingLogic.cacheState.privacyCache.set(normalizedUrl, cached);
          addLog(LogType.DEBUG, 'Privacy cache restored from session storage', { url });
          return cached;
        }
      } catch {
        // session storage エラーは無視
      }
    }

    addLog(LogType.DEBUG, 'Privacy check skipped: no header data', { url });
    return null;
  }

  /**
   * プライバシーキャッシュを無効化する
   */
  static invalidatePrivacyCache(): void {
    addLog(LogType.DEBUG, 'Privacy cache invalidated');
    RecordingLogic.cacheState.privacyCache = null;
    RecordingLogic.cacheState.privacyCacheTimestamp = null;
  }

  /**
   * 保留中ページを保存するヘルパーメソッド
   */
  private async _savePendingPage(url: string, title: string, reason: 'cache-control' | 'set-cookie' | 'authorization', headerValue: string): Promise<void> {
    // Validate headerValue length to prevent storage abuse
    const MAX_HEADER_VALUE_LENGTH = 1024;
    const validatedHeaderValue = (headerValue || '').substring(0, MAX_HEADER_VALUE_LENGTH);

    const pendingPage: PendingPage = {
      url,
      title,
      timestamp: Date.now(),
      reason,
      headerValue: validatedHeaderValue,
      expiry: Date.now() + (24 * 60 * 60 * 1000) // 24時間後
    };

    await addPendingPage(pendingPage);
    addLog(LogType.INFO, 'Page saved to pending', { url, title, reason });
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    // Delegate to RecordingPipeline
    const { RecordingPipeline } = await import('./pipeline/RecordingPipeline.js');
    const pipeline = new RecordingPipeline(
      this.getPrivacyInfoWithCache.bind(this),
      this.obsidian,
      this.aiClient
    );

    return await pipeline.execute(data);
  }

  private async _recordImpl(data: RecordingData): Promise<RecordingResult> {
    let { title, url, content, force = false, skipDuplicateCheck = false, alreadyProcessed = false, previewOnly = false, requireConfirmation = false, headerValue = '', recordType, maskedCount: precomputedMaskedCount, skipAi = false, pageBytes, candidateBytes, originalBytes, cleansedBytes, aiSummaryOriginalBytes, aiSummaryCleansedBytes, aiSummaryCleansedElements, aiSummaryCleansedReason } = data;

    try {
      // 0. Content Truncation (Problem: Large pages can hang the pipeline)
      // 【PII保護】切り詰められたコンテンツのみがAI APIに送信される 🟢
      // 【パフォーマンス】大きなページがパイプラインをハングさせるのを防止
      // 【修正】UTF-16コード単位ではなくバイト数で判定 (Code Review High Priority)
      const truncatedContent = this._truncateContentIfNeeded(data.content);

      // 1. Check domain filter
      const isAllowed = await this._checkDomainFilter(data.url);

      if (!isAllowed && !data.force) {
        return { success: false, error: 'DOMAIN_BLOCKED' };
      }

      if (!isAllowed && data.force) {
        addLog(LogType.WARN, 'Force recording blocked domain', { url: data.url });
      }

      // P0: host_permissions チェック（Top 1000プリセット + 拒否記録）
      const permitted = await this._checkPermission(data.url);
      if (!permitted) {
        return { success: false, error: 'PERMISSION_REQUIRED' };
      }

      // Trust domainチェック（3段階警告: Finance/Sensitive/Unverified）
      const trustCheck = await this._checkTrustDomain(data.url, data.force || false);
      if (!trustCheck.canProceed && !data.force) {
        // 信頼されていないドメイン → 記録ブロック
        addLog(LogType.WARN, 'Domain not trusted, recording blocked', {
          url: data.url,
          reason: trustCheck.reason,
          trustLevel: trustCheck.trustResult.level
        });
        if (trustCheck.showAlert) {
          NotificationHelper.notifyError(
            `Recording Blocked: ${trustCheck.reason || 'Domain not trusted for recording'}`
          );
        }
        return { success: false, error: 'DOMAIN_NOT_TRUSTED' };
      }

      // ホワイトリスト判定と設定の事前取得
      let shouldSkipPrivacyCheck = false;
      let settings: Settings;
      try {
        settings = await this.getSettingsWithCache();
        const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];

        if (whitelist.length > 0) {
          const domain = extractDomain(data.url);

          if (domain && isDomainInList(domain, whitelist)) {
            addLog(LogType.DEBUG, 'Whitelisted domain, bypassing privacy check', {
              url: data.url,
              domain
            });
            shouldSkipPrivacyCheck = true;
          }
        }
      } catch (error: any) {
        // URLパースエラー等が発生した場合、安全側に倒す - プライバシーチェックにフォールバック
        settings = await this.getSettingsWithCache();
        addLog(LogType.ERROR, 'Whitelist check failed, falling back to privacy check', {
          error: error.message,
          url: data.url
        });
        // shouldSkipPrivacyCheck は false のまま（プライバシーチェックを実行）
      }

      // 1.5b. Check privacy headers (ホワイトリスト該当時はスキップ)
      if (!shouldSkipPrivacyCheck) {
        const privacyCheckResult = await this._checkPrivacyHeaders(data.url, data.force || false, data.requireConfirmation || false, settings, data.headerValue || '');
        if (privacyCheckResult && !privacyCheckResult.canProceed) {
          return privacyCheckResult.result;
        }
      }

      // 2. Check for duplicates (日付ベース: 同一ページは1日1回のみ)
      // 設定は既に取得済み
      // Code Review #1: 設定からモードを更新
      // Settings型は StorageKeys でアクセス可能
      this.mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';

      const duplicateCheckResult = await this._checkDuplicates(data.url, data.skipDuplicateCheck || false);
      if (duplicateCheckResult && !duplicateCheckResult.canProceed) {
        return duplicateCheckResult.result;
      }

      const urlMap = duplicateCheckResult?.urlMap;

      // 3. Privacy Pipeline Processing
      const pipeline = new PrivacyPipeline(settings, this.aiClient as any, { sanitizeRegex }); // casting aiClient as any until fully compatible with interface expectation
      let pipelineResult: PrivacyPipelineResult;
      let aiDuration: number | undefined;

      // タグ付き要約モードの設定を取得
      const tagSummaryMode = settings[StorageKeys.TAG_SUMMARY_MODE] as boolean;

      try {
        // AI処理時間を測定（alreadyProcessedがfalseの場合のみAI処理が実行される）
        const aiStartTime = performance.now();

        pipelineResult = await pipeline.process(truncatedContent, {
          previewOnly: data.previewOnly || false,
          alreadyProcessed: data.alreadyProcessed || false,
          tagSummaryMode
        });

        const aiEndTime = performance.now();
        // AI処理が実際に行われた場合のみ時間を記録
        if (!data.alreadyProcessed) {
          aiDuration = aiEndTime - aiStartTime;
        }
      } catch (pipelineError: any) {
        addLog(LogType.ERROR, 'Privacy pipeline failed', {
          error: pipelineError.message,
          url: data.url,
          previewOnly: data.previewOnly,
          mode: this.mode
        });

        if (data.previewOnly) {
          return {
            success: false,
            error: pipelineError.message,
            title: data.title,
            url: data.url
          };
        }
        throw pipelineError;
      }

      if (data.previewOnly) {
        return {
          ...pipelineResult,
          success: pipelineResult.success !== undefined ? pipelineResult.success : true,
          title: data.title,
          url: data.url,
          aiDuration
        };
      }

      const summary = pipelineResult.summary || 'Summary not available.';

      // 4. Format Markdown
      const markdown = this._formatMarkdown(data.title, data.url, summary);

      // 5. Save to Obsidian
      await this._saveToObsidian(markdown, data.title, data.url);

      // 6. Update saved list (日付ベース: Map<URL, timestamp>で管理)
      if (urlMap) {
        urlMap.set(data.url, Date.now());
        await setSavedUrlsWithTimestamps(urlMap, data.url);
      }

      // メタデータを保存
      await this._saveMetadata(data, pipelineResult, urlMap);

      // 7. Notification
      NotificationHelper.notifySuccess('Saved to Obsidian', `Saved: ${data.title}`);

      return { success: true, aiDuration };

    } catch (e: any) {
      addLog(LogType.ERROR, 'Failed to process recording', { error: e.message, url });
      NotificationHelper.notifyError(e.message);

      return { success: false, error: e.message };
    }
  }

  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    const result = await this.record({ ...data, previewOnly: true });
    return result;
  }
}