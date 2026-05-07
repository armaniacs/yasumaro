// src/background/recordingLogic.ts
import { PrivacyPipeline, PrivacyPipelineOptions, PrivacyPipelineResult } from './privacyPipeline.js';
import { NotificationHelper } from './notificationHelper.js';
import { addLog, LogType } from '../utils/logger.js';
import { isDomainAllowed, isDomainInList, extractDomain } from '../utils/domainUtils.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { getSettings, StorageKeys, getSavedUrlsWithTimestamps, setSavedUrlsWithTimestamps, saveSettings, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD, Settings } from '../utils/storage.js';
import { setUrlRecordType, setUrlMaskedCount, setUrlTags, setUrlContent, setUrlAiSummary, setUrlSentTokens, setUrlReceivedTokens, setUrlOriginalTokens, setUrlCleansedTokens, setUrlPageBytes, setUrlCandidateBytes, setUrlOriginalBytes, setUrlCleansedBytes, setUrlAiSummaryOriginalBytes, setUrlAiSummaryCleansedBytes, setUrlAiSummaryCleansedElements, setUrlAiSummaryCleansedReason, setUrlAiSummaryCleansedReasons, setUrlAiProvider, setUrlAiModel, setUrlAiDuration, setUrlObsidianDuration, setUrlFallbackTriggered } from '../utils/storageUrls.js';
import type { RecordType } from '../utils/commonTypes.js';
import { getUserLocale } from '../utils/localeUtils.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { sanitizeUrlForLogging } from '../utils/urlUtils.js';
import { isPrivateIpAddress } from '../utils/fetch.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { isPrivacyInfo } from '../utils/privacyChecker.js';
import { normalizeJapaneseSummary } from '../utils/summaryNormalizer.js';
import { addPendingPage, PendingPage } from '../utils/pendingStorage.js';
import { SessionStore, SESSION_KEYS } from './sessionStore.js';
// P0: host_permissions チェック（Top 1000プリセット + 拒否記録）
import { getPermissionManager } from '../utils/permissionManager.js';

// Trust domain checker（3段階警告）
import { TrustChecker } from '../utils/trustChecker.js';
import type { TrustCheckResult } from '../utils/trustChecker.js';

// RecordingResult, MaskedItem 型 - messaging/types.tsからインポート
import type { RecordingResult, MaskedItem } from '../messaging/types.js';
import { redactHeaderValue } from '../utils/redaction.js';

// RecordingPipeline - 静的インポート（動的import()はService Workerで禁止）
import { RecordingPipeline } from './pipeline/RecordingPipeline.js';

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

/**
 * プライバシーチェック結果の型
 * Note: Uses same shape as RecordingResult for compatibility
 */
interface PrivacyCheckResult {
  success: boolean;
  error?: string;
  reason?: string;
  confirmationRequired?: boolean;
  skipped?: boolean;
  summary?: string;
  title?: string;
  url?: string;
}

/**
 * 重複チェック結果の型
 */
interface DuplicateCheckResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Trustチェック結果の型（trustChecker.tsのTrustCheckResult互換）
 */
interface TrustDomainCheckResult {
  canProceed: boolean;
  trustResult: {
    level: string;
    source?: string;
    reason?: string;
    category?: string;
  };
  showAlert: boolean;
  reason?: string;
}

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
export function isValidFetchUrl(url: string): boolean {
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
  originalBytes?: number;   // Content Cleansing前のバイト数
  cleansedBytes?: number;   // Content Cleansing後のバイト数
  aiSummaryOriginalBytes?: number;  // AI要約クレンジング前のバイト数
  aiSummaryCleansedBytes?: number;  // AI要約クレンジング後のバイト数
  aiSummaryCleansedElements?: number;  // AI要約クレンジングで削除した要素数
  aiSummaryCleansedReason?: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';  // AI要約クレンジング実行理由
  aiSummaryCleansedReasons?: string[];  // 複数理由の詳細リスト（multiple時）
  fallbackTriggered?: boolean;          // NEW: フォールバックが発動したか

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

  static sessionStore: SessionStore = new SessionStore();

  /**
   * Session storage からキャッシュ状態を復元
   */
  static async loadCacheFromSession(): Promise<void> {
    try {
      const saved = await RecordingLogic.sessionStore.get<{
        settingsCache: Settings | null;
        cacheTimestamp: number | null;
        cacheVersion: number;
        urlCache: [string, number][] | null;
        urlCacheTimestamp: number | null;
        privacyCache: [string, PrivacyInfo][] | null;
        privacyCacheTimestamp: number | null;
      }>(SESSION_KEYS.RECORDING_CACHE);
      if (!saved) return;
      const now = Date.now();
      if (saved.settingsCache && saved.cacheTimestamp && (now - saved.cacheTimestamp) < 30000) {
        RecordingLogic.cacheState.settingsCache = saved.settingsCache;
        RecordingLogic.cacheState.cacheTimestamp = saved.cacheTimestamp;
        RecordingLogic.cacheState.cacheVersion = saved.cacheVersion;
      }
      if (saved.urlCache && saved.urlCacheTimestamp && (now - saved.urlCacheTimestamp) < 60000) {
        RecordingLogic.cacheState.urlCache = SessionStore.entriesToMap(saved.urlCache);
        RecordingLogic.cacheState.urlCacheTimestamp = saved.urlCacheTimestamp;
      }
      if (saved.privacyCache && saved.privacyCacheTimestamp && (now - saved.privacyCacheTimestamp) < 300000) {
        RecordingLogic.cacheState.privacyCache = SessionStore.entriesToMap(saved.privacyCache);
        RecordingLogic.cacheState.privacyCacheTimestamp = saved.privacyCacheTimestamp;
      }
    } catch {
      // session store unavailable
    }
  }

  private static saveQueueScheduled = false;

  /**
   * キャッシュ状態を session storage に保存（デバウンス）
   */
  static scheduleCacheSave(): void {
    if (RecordingLogic.saveQueueScheduled) return;
    RecordingLogic.saveQueueScheduled = true;
    queueMicrotask(() => {
      RecordingLogic.saveQueueScheduled = false;
      RecordingLogic.saveCacheToSession();
    });
  }

  private static saveCacheToSession(): void {
    const cs = RecordingLogic.cacheState;
    RecordingLogic.sessionStore.set(SESSION_KEYS.RECORDING_CACHE, {
      settingsCache: cs.settingsCache,
      cacheTimestamp: cs.cacheTimestamp,
      cacheVersion: cs.cacheVersion,
      urlCache: cs.urlCache ? SessionStore.mapToEntries(cs.urlCache) : null,
      urlCacheTimestamp: cs.urlCacheTimestamp,
      privacyCache: cs.privacyCache ? SessionStore.mapToEntries(cs.privacyCache) : null,
      privacyCacheTimestamp: cs.privacyCacheTimestamp,
    });
  }

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
    RecordingLogic.scheduleCacheSave();

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
    RecordingLogic.scheduleCacheSave();
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
    RecordingLogic.scheduleCacheSave();

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
    RecordingLogic.scheduleCacheSave();
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
        const cached = isPrivacyInfo(result[sessionKey]) ? result[sessionKey] : undefined;
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
    RecordingLogic.scheduleCacheSave();
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    // Delegate to RecordingPipeline
    const pipeline = new RecordingPipeline(
      this.getPrivacyInfoWithCache.bind(this),
      this.obsidian,
      this.aiClient
    );

    // Get settings with cache
    const settings = await this.getSettingsWithCache();

    return await pipeline.execute(data, settings);
  }

  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    const result = await this.record({ ...data, previewOnly: true });
    return result;
  }
}