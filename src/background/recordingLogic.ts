// src/background/recordingLogic.ts
import { PrivacyPipeline, PrivacyPipelineOptions, PrivacyPipelineResult } from './privacyPipeline.js';
import { NotificationHelper } from './notificationHelper.js';
import { addLog, LogType } from '../utils/logger.js';
import { isDomainAllowed, isDomainInList, extractDomain } from '../utils/domainUtils.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { getSettings, StorageKeys, getSavedUrlsWithTimestamps, setSavedUrlsWithTimestamps, saveSettings, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD, Settings } from '../utils/storage.js';
import { getUserLocale } from '../utils/localeUtils.js';
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { addPendingPage, PendingPage } from '../utils/pendingStorage.js';

const SETTINGS_CACHE_TTL = 30 * 1000; // 30 seconds
const URL_CACHE_TTL = 60 * 1000; // 60 seconds (Problem #7用)

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
}

export interface RecordingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string;
  summary?: string;
  title?: string;
  url?: string;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: any[];
  /** AI処理時間 (ミリ秒) */
  aiDuration?: number;
  confirmationRequired?: boolean;
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
   * URLのプライバシー情報をキャッシュから取得する
   * TTL: 5分
   */
  async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
    const now = Date.now();
    const PRIVACY_CACHE_TTL = 5 * 60 * 1000; // 5分

    if (RecordingLogic.cacheState.privacyCache) {
      const cached = RecordingLogic.cacheState.privacyCache.get(url);
      if (cached && (now - cached.timestamp) < PRIVACY_CACHE_TTL) {
        addLog(LogType.DEBUG, 'Privacy cache hit', { url });
        return cached;
      }
    }

    // キャッシュミス: ヘッダー情報がまだ収集されていない
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
    const pendingPage: PendingPage = {
      url,
      title,
      timestamp: Date.now(),
      reason,
      headerValue: headerValue || '',
      expiry: Date.now() + (24 * 60 * 60 * 1000) // 24時間後
    };

    await addPendingPage(pendingPage);
    addLog(LogType.INFO, 'Page saved to pending', { url, title, reason });
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    let { title, url, content, force = false, skipDuplicateCheck = false, alreadyProcessed = false, previewOnly = false, requireConfirmation = false, headerValue = '' } = data;
    const MAX_RECORD_SIZE = 64 * 1024;

    try {
      // 0. Content Truncation (Problem: Large pages can hang the pipeline)
      if (content && content.length > MAX_RECORD_SIZE) {
        addLog(LogType.WARN, 'Content truncated for recording', {
          originalLength: content.length,
          truncatedLength: MAX_RECORD_SIZE,
          url
        });
        content = content.substring(0, MAX_RECORD_SIZE);
      }

      // 1. Check domain filter
      const isAllowed = await isDomainAllowed(url);

      if (!isAllowed && !force) {
        return { success: false, error: 'DOMAIN_BLOCKED' };
      }

      if (!isAllowed && force) {
        addLog(LogType.WARN, 'Force recording blocked domain', { url });
      }

      // ホワイトリスト判定と設定の事前取得
      let shouldSkipPrivacyCheck = false;
      let settings: Settings;
      try {
        settings = await this.getSettingsWithCache();
        const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];

        if (whitelist.length > 0) {
          const domain = extractDomain(url);

          if (domain && isDomainInList(domain, whitelist)) {
            addLog(LogType.DEBUG, 'Whitelisted domain, bypassing privacy check', {
              url,
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
          url
        });
        // shouldSkipPrivacyCheck は false のまま（プライバシーチェックを実行）
      }

      // 1.5b. Check privacy headers (ホワイトリスト該当時はスキップ)
      if (!shouldSkipPrivacyCheck) {
        const privacyInfo = await this.getPrivacyInfoWithCache(url);
        if (privacyInfo?.isPrivate && !force) {
          addLog(LogType.WARN, 'Private page detected', {
            url,
            reason: privacyInfo.reason,
            requireConfirmation
          });

          // requireConfirmationの場合、pendingに保存してconfirmationRequired=trueを返す
          if (requireConfirmation) {
            await this._savePendingPage(url, title, privacyInfo.reason, headerValue);
            return {
              success: false,
              error: 'PRIVATE_PAGE_DETECTED',
              reason: privacyInfo.reason,
              confirmationRequired: true
            };
          }

          return {
            success: false,
            error: 'PRIVATE_PAGE_DETECTED',
            reason: privacyInfo.reason
          };
        }

        if (privacyInfo?.isPrivate && force) {
          addLog(LogType.WARN, 'Force recording private page', {
            url,
            reason: privacyInfo.reason
          });
        }
      }

      // 2. Check for duplicates (日付ベース: 同一ページは1日1回のみ)
      // 設定は既に取得済み
      // Code Review #1: 設定からモードを更新
      // Settings型は StorageKeys でアクセス可能
      this.mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
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
            return { success: true, skipped: true, reason: 'same_day' };
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
        NotificationHelper.notifyError(`URL history limit reached. Maximum ${MAX_URL_SET_SIZE} URLs allowed. Please clear your history.`);
        return { success: false, error: 'URL set size limit exceeded. Please clear your history.' };
      }

      // Problem #4: 警告閾値チェック
      if (urlMap.size >= URL_WARNING_THRESHOLD) {
        addLog(LogType.WARN, 'URL set size approaching limit', {
          current: urlMap.size,
          threshold: URL_WARNING_THRESHOLD,
          remaining: MAX_URL_SET_SIZE - urlMap.size
        });
      }

      // 3. Privacy Pipeline Processing
      const pipeline = new PrivacyPipeline(settings, this.aiClient as any, { sanitizeRegex }); // casting aiClient as any until fully compatible with interface expectation
      let pipelineResult: PrivacyPipelineResult;
      let aiDuration: number | undefined;

      try {
        // AI処理時間を測定（alreadyProcessedがfalseの場合のみAI処理が実行される）
        const aiStartTime = performance.now();

        pipelineResult = await pipeline.process(content, {
          previewOnly,
          alreadyProcessed
        });

        const aiEndTime = performance.now();
        // AI処理が実際に行われた場合のみ時間を記録
        if (!alreadyProcessed) {
          aiDuration = aiEndTime - aiStartTime;
        }
      } catch (pipelineError: any) {
        addLog(LogType.ERROR, 'Privacy pipeline failed', {
          error: pipelineError.message,
          url,
          previewOnly,
          mode: this.mode
        });

        if (previewOnly) {
          return {
            success: false,
            error: pipelineError.message,
            title,
            url
          };
        }
        throw pipelineError;
      }

      if (previewOnly) {
        return {
          ...pipelineResult,
          success: pipelineResult.success !== undefined ? pipelineResult.success : true,
          title,
          url,
          aiDuration
        };
      }

      const summary = pipelineResult.summary || 'Summary not available.';

      // 4. Format Markdown
      // P1: XSS対策 - summaryをサニタイズ（Markdownリンクのエスケープ）
      const sanitizedSummary = sanitizeForObsidian(summary);
      const sanitizedTitle = sanitizeForObsidian(title);
      const timestamp = new Date().toLocaleTimeString(getUserLocale(), { hour: '2-digit', minute: '2-digit' });
      const markdown = `- ${timestamp} [${sanitizedTitle}](${url})\n    - AI要約: ${sanitizedSummary}`;

      // 5. Save to Obsidian
      await this.obsidian.appendToDailyNote(markdown);
      addLog(LogType.INFO, 'Saved to Obsidian', { title, url });

      // 6. Update saved list (日付ベース: Map<URL, timestamp>で管理)
      urlMap.set(url, Date.now());
      await setSavedUrlsWithTimestamps(urlMap, url);
      // Problem #7: URLキャッシュを無効化
      RecordingLogic.invalidateUrlCache();

      // 7. Notification
      NotificationHelper.notifySuccess('Saved to Obsidian', `Saved: ${title}`);

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