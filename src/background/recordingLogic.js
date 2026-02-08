// src/background/recordingLogic.js
import { PrivacyPipeline } from './privacyPipeline.js';
import { NotificationHelper } from './notificationHelper.js';
import { addLog, LogType } from '../utils/logger.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { sanitizeRegex } from '../utils/piiSanitizer.js';
import { getSettings, StorageKeys, getSavedUrls, setSavedUrls, saveSettings, MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD } from '../utils/storage.js';

const SETTINGS_CACHE_TTL = 30 * 1000; // 30 seconds
const URL_CACHE_TTL = 60 * 1000; // 60 seconds (Problem #7用)

export class RecordingLogic {
  // キャッシュ状態永続化（SERVICE-WORKER再起動間で保持）
  // Problem #3: 2重キャッシュ構造を1段階に簡素化 - staticキャッシュのみ使用
  // Problem #7: URLキャッシュも追加
  static cacheState = {
    settingsCache: null,
    cacheTimestamp: null,
    cacheVersion: 0,
    urlCache: null,
    urlCacheTimestamp: null
  };

  constructor(obsidianClient, aiClient) {
    this.obsidian = obsidianClient;
    this.aiClient = aiClient;
    // Problem #3: 2重キャッシュ構造を1段階に簡素化 - インスタンスキャッシュを削除
  }

  /**
   * 設定キャッシュから取得する
   * Problem #3: 2重キャッシュ構造を1段階に簡素化
   */
  async getSettingsWithCache() {
    const now = Date.now();

    // staticキャッシュを確認
    if (RecordingLogic.cacheState.settingsCache) {
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
  async _fetchAndCacheSettings(now) {
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
  static invalidateSettingsCache() {
    addLog(LogType.DEBUG, 'Settings cache invalidated');
    RecordingLogic.cacheState.settingsCache = null;
    RecordingLogic.cacheState.cacheTimestamp = null;
    RecordingLogic.cacheState.cacheVersion++;
  }

  /**
   * インスタンスキャッシュを無効化する
   * Problem #3: 2重キャッシュを1段階に簡素化したためno-op
   */
  invalidateInstanceCache() {
    // 何もしない - 簡素化により不要になったメソッド
    addLog(LogType.DEBUG, 'invalidateInstanceCache called (no-op after simplification)');
  }

  /**
   * URLキャッシュから保存済みURLを取得する
   * Problem #7: getSavedUrls() キャッシュ追加
   */
  async getSavedUrlsWithCache() {
    const now = Date.now();

    // URLキャッシュを確認
    if (RecordingLogic.cacheState.urlCache) {
      const age = now - RecordingLogic.cacheState.urlCacheTimestamp;
      if (age < URL_CACHE_TTL) {
        addLog(LogType.DEBUG, 'URL cache hit', { count: RecordingLogic.cacheState.urlCache.size, age: age + 'ms' });
        return new Set(RecordingLogic.cacheState.urlCache); // 新しいSetを返して変更の影響を防ぐ
      }
    }

    // キャッシュが無効な場合、storageから取得
    const urlSet = await getSavedUrls();
    RecordingLogic.cacheState.urlCache = new Set(urlSet);
    RecordingLogic.cacheState.urlCacheTimestamp = now;

    addLog(LogType.DEBUG, 'URL cache updated', { count: urlSet.size });

    return urlSet;
  }

  /**
   * URLキャッシュを無効化する
   * Problem #7: URLキャッシュ追加に伴う無効化メソッド
   */
  static invalidateUrlCache() {
    addLog(LogType.DEBUG, 'URL cache invalidated');
    RecordingLogic.cacheState.urlCache = null;
    RecordingLogic.cacheState.urlCacheTimestamp = null;
  }

  async record(data) {
    const { title, url, content, force = false, skipDuplicateCheck = false, alreadyProcessed = false, previewOnly = false } = data;

    try {
      // 1. Check domain filter
      const isAllowed = await isDomainAllowed(url);

      if (!isAllowed && !force) {
        return { success: false, error: 'DOMAIN_BLOCKED' };
      }

      if (!isAllowed && force) {
        addLog(LogType.WARN, 'Force recording blocked domain', { url });
      }

      // 2. Check for duplicates
      // 設定キャッシュを使用
      const settings = await this.getSettingsWithCache();
      // Problem #7: キャッシュ付きURL取得を使用
      const urlSet = await this.getSavedUrlsWithCache();

      if (!skipDuplicateCheck && urlSet.has(url)) {
        return { success: true, skipped: true };
      }

      // Problem #4: URLセットサイズ制限チェック
      if (urlSet.size >= MAX_URL_SET_SIZE) {
        addLog(LogType.ERROR, 'URL set size limit exceeded', {
          current: urlSet.size,
          max: MAX_URL_SET_SIZE,
          url
        });
        NotificationHelper.notifyError(`URL history limit reached. Maximum ${MAX_URL_SET_SIZE} URLs allowed. Please clear your history.`);
        return { success: false, error: 'URL set size limit exceeded. Please clear your history.' };
      }

      // Problem #4: 警告閾値チェック
      if (urlSet.size >= URL_WARNING_THRESHOLD) {
        addLog(LogType.WARN, 'URL set size approaching limit', {
          current: urlSet.size,
          threshold: URL_WARNING_THRESHOLD,
          remaining: MAX_URL_SET_SIZE - urlSet.size
        });
      }

      // 3. Privacy Pipeline Processing
      const pipeline = new PrivacyPipeline(settings, this.aiClient, { sanitizeRegex });
      let pipelineResult;

      try {
        pipelineResult = await pipeline.process(content, {
          previewOnly,
          alreadyProcessed
        });
      } catch (pipelineError) {
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
          url
        };
      }

      const summary = pipelineResult.summary || 'Summary not available.';

      // 4. Format Markdown
      const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const markdown = `- ${timestamp} [${title}](${url})\n    - AI要約: ${summary}`;

      // 5. Save to Obsidian
      await this.obsidian.appendToDailyNote(markdown);
      addLog(LogType.INFO, 'Saved to Obsidian', { title, url });

      // 6. Update saved list
      if (!urlSet.has(url)) {
        urlSet.add(url);
        await setSavedUrls(urlSet);
        // Problem #7: URLキャッシュを無効化
        RecordingLogic.invalidateUrlCache();
      }

      // 7. Notification
      NotificationHelper.notifySuccess('Saved to Obsidian', `Saved: ${title}`);

      return { success: true };

    } catch (e) {
      addLog(LogType.ERROR, 'Failed to process recording', { error: e.message, url });
      NotificationHelper.notifyError(e.message);

      return { success: false, error: e.message };
    }
  }

  async recordWithPreview(data) {
    const result = await this.record({ ...data, previewOnly: true });
    return result;
  }
}