import { PrivacyPipeline } from './privacyPipeline.js';
import { Settings } from '../utils/storage.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
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
}
export declare class RecordingLogic {
    static cacheState: CacheState;
    private obsidian;
    private aiClient;
    private mode;
    constructor(obsidianClient: ObsidianClient, aiClient: AIClient, privacyPipeline?: PrivacyPipeline | null);
    /**
     * 設定キャッシュから取得する
     * Problem #3: 2重キャッシュ構造を1段階に簡素化
     */
    getSettingsWithCache(): Promise<Settings>;
    /**
     * storageから設定を取得しキャッシュに保存
     * Problem #3: 2重キャッシュ構造を1段階に簡素化
     */
    _fetchAndCacheSettings(now: number): Promise<Settings>;
    /**
     * 設定キャッシュを無効化する
     * 設定が変更された場合に呼び出す
     */
    static invalidateSettingsCache(): void;
    /**
     * インスタンスキャッシュを無効化する
     * Problem #3: 2重キャッシュを1段階に簡素化したためno-op
     */
    invalidateInstanceCache(): void;
    /**
     * URLキャッシュから保存済みURLを取得する（日付ベース重複チェック用）
     * Map<string, number> (URL -> timestamp) を返す
     */
    getSavedUrlsWithCache(): Promise<Map<string, number>>;
    /**
     * URLキャッシュを無効化する
     * Problem #7: URLキャッシュ追加に伴う無効化メソッド
     */
    static invalidateUrlCache(): void;
    /**
     * URLのプライバシー情報をキャッシュから取得する
     * TTL: 5分
     */
    getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null>;
    /**
     * プライバシーキャッシュを無効化する
     */
    static invalidatePrivacyCache(): void;
    record(data: RecordingData): Promise<RecordingResult>;
    recordWithPreview(data: RecordingData): Promise<RecordingResult>;
}
export {};
//# sourceMappingURL=recordingLogic.d.ts.map