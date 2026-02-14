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

/**
 * ServiceWorkerContextクラス
 * Service Workerに必要な依存オブジェクトを管理し、
 * 必要に応じてデフォルト実装またはカスタム実装を提供する
 *
 * @class ServiceWorkerContext
 */
export class ServiceWorkerContext {
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
    constructor(dependencies = {}) {
        this.dependencies = {
            // デフォルト実装を使用（またはカスタム実装を注入）
            tabCache: dependencies.tabCache || new TabCache(),
            mutex: dependencies.mutex || new Mutex(),
            obsidianClient: dependencies.obsidianClient || null, // 遅延初期化
            aiClient: dependencies.aiClient || null, // 遅延初期化
            recordingLogic: dependencies.recordingLogic || null, // 遅延初期化
            privacyPipeline: dependencies.privacyPipeline || null // 遅延初期化
        };
    }

    /**
     * タブキャッシュを取得
     * @returns {TabCache}
     */
    getTabCache() {
        return this.dependencies.tabCache;
    }

    /**
     * Mutexを取得
     * @returns {Mutex}
     */
    getMutex() {
        return this.dependencies.mutex;
    }

    /**
     * Obsidianクライアントを取得（遅延初期化）
     * @returns {ObsidianClient}
     */
    getObsidianClient() {
        if (!this.dependencies.obsidianClient) {
            this.dependencies.obsidianClient = new ObsidianClient({
                mutex: this.dependencies.mutex
            });
        }
        return this.dependencies.obsidianClient;
    }

    /**
     * AIクライアントを取得（遅延初期化）
     * @returns {AIClient}
     */
    getAIClient() {
        if (!this.dependencies.aiClient) {
            this.dependencies.aiClient = new AIClient();
        }
        return this.dependencies.aiClient;
    }

    /**
     * 記録ロジックを取得（遅延初期化）
     * @returns {RecordingLogic}
     */
    getRecordingLogic() {
        if (!this.dependencies.recordingLogic) {
            this.dependencies.recordingLogic = new RecordingLogic(
                this.dependencies.obsidianClient || this.getObsidianClient(),
                this.dependencies.aiClient || this.getAIClient(),
                this.dependencies.privacyPipeline || this.getPrivacyPipeline()
            );
        }
        return this.dependencies.recordingLogic;
    }

    /**
     * プライバシーパイプラインを取得（遅延初期化）
     * @returns {PrivacyPipeline}
     */
    getPrivacyPipeline() {
        if (!this.dependencies.privacyPipeline) {
            this.dependencies.privacyPipeline = new PrivacyPipeline();
        }
        return this.dependencies.privacyPipeline;
    }

    /**
     * コンテキスト全体を初期化
     * 必要な初期化処理を順次実行
     * @returns {Promise<void>}
     */
    async initialize() {
        const tabCache = this.getTabCache();
        await tabCache.initialize();
    }

    /**
     * 依存オブジェクトを置換（テスト用）
     * @param {string} name - 依存オブジェクト名
     * @param {Object} value - 新しい値
     */
    setDependency(name, value) {
        if (name in this.dependencies) {
            this.dependencies[name] = value;
        } else {
            throw new Error(`Unknown dependency: ${name}`);
        }
    }
}

/**
 * グローバルコンテキストインスタンス
 *
 * @var {ServiceWorkerContext} globalContext
 */
let globalContext = null;

/**
 * グローバルコンテキストを取得
 * まだ作成されていない場合はデフォルトで作成
 *
 * @returns {ServiceWorkerContext}
 */
export function getGlobalContext() {
    if (!globalContext) {
        globalContext = new ServiceWorkerContext();
    }
    return globalContext;
}

/**
 * グローバルコンテキストを設定
 * テストや初期化時にカスタムコンテキストを注入
 *
 * @param {ServiceWorkerContext} context - 新しいコンテキスト
 * @returns {void}
 */
export function setGlobalContext(context) {
    globalContext = context;
}

/**
 * グローバルコンテキストをリセット（テスト用）
 *
 * @returns {void}
 */
export function resetGlobalContext() {
    globalContext = null;
}