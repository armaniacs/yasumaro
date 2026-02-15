/**
 * ServiceWorkerContext
 *
 * Service Workerの依存性を管理し、依存性注入を可能にするコンテキストクラス
 *
 * 【DIP Compliance】:
 * - 高レベルモジュール（Service Worker）は抽象化に依存
 * - 具体的な実装（ObsidianClient, AIClient等）はコンテキストを通じて注入
 *
 * 【Benefits】:
 * - テスト容易性: モックの注入が可能
 * - 疎結合: モジュール間の直接的な依存を削減
 * - 柔軟性: 実装の変更に容易に対応
 */
import { TabCache } from './tabCache.js';
import { Mutex } from './Mutex.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { PrivacyPipeline } from './privacyPipeline.js';
export interface ServiceWorkerDependencies {
    tabCache?: TabCache;
    mutex?: Mutex;
    obsidianClient?: ObsidianClient | null;
    aiClient?: AIClient | null;
    recordingLogic?: RecordingLogic | null;
    privacyPipeline?: PrivacyPipeline | null;
}
/**
 * ServiceWorkerContextクラス
 * Service Workerに必要な依存オブジェクトを管理し、
 * 必要に応じてデフォルト実装またはカスタム実装を提供する
 *
 * @class ServiceWorkerContext
 */
export declare class ServiceWorkerContext {
    private dependencies;
    /**
     * コンテキストを作成
     * @param {Object} dependencies - 依存オブジェクト（オプション）
     * @param {TabCache} dependencies.tabCache - タブキャッシュ
     * @param {Mutex} dependencies.mutex - Mutex（排他制御）
     * @param {ObsidianClient} dependencies.obsidianClient - Obsidianクライアント
     * @param {AIClient} dependencies.aiClient - AIクライアント
     * @param {RecordingLogic} dependencies.recordingLogic - 記録ロジック
     * @param {PrivacyPipeline} dependencies.privacyPipeline - プライバシーパイプライン
     */
    constructor(dependencies?: ServiceWorkerDependencies);
    /**
     * タブキャッシュを取得
     * @returns {TabCache}
     */
    getTabCache(): TabCache;
    /**
     * Mutexを取得
     * @returns {Mutex}
     */
    getMutex(): Mutex;
    /**
     * Obsidianクライアントを取得（遅延初期化）
     * @returns {ObsidianClient}
     */
    getObsidianClient(): ObsidianClient;
    /**
     * AIクライアントを取得（遅延初期化）
     * @returns {AIClient}
     */
    getAIClient(): AIClient;
    /**
     * 記録ロジックを取得（遅延初期化）
     * @returns {RecordingLogic}
     */
    getRecordingLogic(): RecordingLogic;
    /**
     * プライバシーパイプラインを取得（遅延初期化）
     * @returns {PrivacyPipeline}
     */
    getPrivacyPipeline(): PrivacyPipeline | null;
    /**
     * コンテキスト全体を初期化
     * 必要な初期化処理を順次実行
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
    /**
     * 依存オブジェクトを置換（テスト用）
     * @param {string} name - 依存オブジェクト名
     * @param {Object} value - 新しい値
     */
    setDependency(name: keyof ServiceWorkerDependencies, value: any): void;
}
/**
 * グローバルコンテキストを取得
 * まだ作成されていない場合はデフォルトで作成
 *
 * @returns {ServiceWorkerContext}
 */
export declare function getGlobalContext(): ServiceWorkerContext;
/**
 * グローバルコンテキストを設定
 * テストや初期化時にカスタムコンテキストを注入
 *
 * @param {ServiceWorkerContext} context - 新しいコンテキスト
 * @returns {void}
 */
export declare function setGlobalContext(context: ServiceWorkerContext): void;
/**
 * グローバルコンテキストをリセット（テスト用）
 *
 * @returns {void}
 */
export declare function resetGlobalContext(): void;
//# sourceMappingURL=ServiceWorkerContext.d.ts.map