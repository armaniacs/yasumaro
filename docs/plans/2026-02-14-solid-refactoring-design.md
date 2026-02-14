# SOLID原則に基づく設計改善プラン

**作成日:** 2026-02-14
**目的:** SOLID原則の違反箇所を特定し、コードの設計品質を向上させる

---

## 総評

本プロジェクトはChrome拡張機能として比較的明確なモジュール分割が行われていますが、いくつかの主要なクラスが複数の責任を有しており、拡張性とテスト容易性の観点で改善が必要です。

| 原則 | 評価 | 主要な問題 |
|------|------|-----------|
| S（単一責任） | △ | Service Worker、AIClient、ObsidianClientが複数の責任を有している |
| O（開放閉鎖） | × | 新しいAIプロバイダー追加時に既存コードを修正する必要がある |
| L（リスコフ置換） | N/A | 明確な継承関係がないため適用不可 |
| I（インターフェース分離） | △ | 明確なインターフェース定義が存在しない |
| D（依存性逆転） | × | 具体的なクラスに直接依存している |

---

## 改善プラン

### 1. 単一責任の原則（SRP）の改善

#### 1.1 TabCacheの分離

**問題:** TabCache管理がService Workerに埋め込まれている

**影響範囲:**
- `src/background/service-worker.js`
- TabCache関連の全処理

**変更内容:**
- 新規作成: `src/background/tabCache.js`
- TabCache管理ロジックをService Workerから分離

**新規ファイル: `src/background/tabCache.js`**
```javascript
/**
 * TabCache
 * Service Workerにおけるタブ情報のキャッシュ管理
 */

export class TabCache {
    constructor() {
        this.cache = new Map();
        this.isInitialized = false;
        this.initPromise = null;
    }

    /**
     * キャッシュを初期化
     */
    async initialize() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve) => {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.startsWith('http')) {
                        this.cache.set(tab.id, {
                            title: tab.title,
                            url: tab.url,
                            favIconUrl: tab.favIconUrl,
                            lastUpdated: Date.now(),
                            isValidVisit: false,
                            content: null
                        });
                    }
                });
                this.isInitialized = true;
                resolve();
            });
        });
        return this.initPromise;
    }

    /**
     * タブ情報を追加
     */
    add(tab) {
        if (tab.id && tab.url && tab.url.startsWith('http')) {
            this.cache.set(tab.id, {
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                lastUpdated: Date.now(),
                isValidVisit: false,
                content: null
            });
        }
    }

    /**
     * タブ情報を取得
     */
    get(tabId) {
        return this.cache.get(tabId) || null;
    }

    /**
     * タブ情報を更新
     */
    update(tabId, data) {
        const current = this.cache.get(tabId);
        if (current) {
            this.cache.set(tabId, { ...current, ...data });
        }
    }

    /**
     * タブ情報を削除
     */
    remove(tabId) {
        this.cache.delete(tabId);
    }

    /**
     * 複数のタブを削除
     */
    removeAll(tabIds) {
        tabIds.forEach(tabId => this.remove(tabId));
    }

    /**
     * 全キャッシュをクリア
     */
    clear() {
        this.cache.clear();
        this.isInitialized = false;
        this.initPromise = null;
    }

    /**
     * キャッシュサイズを取得
     */
    size() {
        return this.cache.size;
    }

    /**
     * 全てのタブ情報を取得
     */
    getAll() {
        return this.cache.values();
    }
}
```

**変更後の `service-worker.js` 使用例:**
```javascript
import { TabCache } from './tabCache.js';

const tabCache = new TabCache();

// メッセージハンドラ内
if (message.type !== 'TEST_CONNECTIONS') {
    await tabCache.initialize();
}

// タブを使用する箇所で
tabCache.add(sender.tab);
const tabData = tabCache.get(tabId);
tabCache.update(tabId, { content: message.payload?.content });

// タブ閉じるイベント
chrome.tabs.onRemoved.addListener((tabId) => {
    tabCache.remove(tabId);
});
```

---

#### 1.2 Mutexの分離

**問題:** MutexがObsidianClientに埋め込まれている

**影響範囲:**
- `src/background/obsidianClient.js`
- Mutexクラス定義（39-162行目）

**変更内容:**
- 新規作成: `src/background/Mutex.js`
- Mutexクラスを独立させる

**新規ファイル: `src/background/Mutex.js`**
```javascript
/**
 * Mutex
 * 排他制御用クラス
 * リソースへの同時アクセスを防止し、順次処理を実現
 */

import { addLog, LogType } from '../utils/logger.js';

export class Mutex {
    constructor(options = {}) {
        this.locked = false;
        this.queue = new Map();
        this.lockedAt = null;
        this.nextTaskId = 0;
        this.maxQueueSize = options.maxQueueSize || 50;
        this.timeoutMs = options.timeoutMs || 30000;
    }

    /**
     * ロックを取得する
     */
    async acquire() {
        const now = Date.now();

        if (this.queue.size >= this.maxQueueSize) {
            addLog(LogType.ERROR, 'Mutex: Queue is full, rejecting request', {
                queueLength: this.queue.size,
                maxSize: this.maxQueueSize
            });
            throw new Error(`Mutex queue is full (max ${this.maxQueueSize}). Too many concurrent requests.`);
        }

        if (this.locked) {
            return new Promise((resolve, reject) => {
                const taskId = this.nextTaskId++;
                const timeoutId = setTimeout(() => {
                    this.queue.delete(taskId);
                    reject(new Error(`Mutex acquisition timeout after ${this.timeoutMs}ms`));
                }, this.timeoutMs);

                this.queue.set(taskId, {
                    resolve: () => {
                        clearTimeout(timeoutId);
                        resolve();
                    },
                    reject,
                    timestamp: now,
                    timeoutId
                });
            });
        }

        this.locked = true;
        this.lockedAt = Date.now();
        addLog(LogType.DEBUG, 'Mutex: Lock acquired');
    }

    /**
     * ロックを解放する
     */
    release() {
        if (!this.locked) {
            addLog(LogType.WARN, 'Mutex: Attempting to release unlocked mutex');
            return;
        }

        if (this.queue.size > 0) {
            const [taskId, task] = this.queue.entries().next().value;
            this.queue.delete(taskId);

            if (task && task.timeoutId) {
                clearTimeout(task.timeoutId);
            }

            this.lockedAt = Date.now();

            if (task && task.resolve) {
                task.resolve();
            }

            addLog(LogType.DEBUG, 'Mutex: Lock transferred to waiting task', {
                remainingQueue: this.queue.size
            });
        } else {
            this.locked = false;
            this.lockedAt = null;
            addLog(LogType.DEBUG, 'Mutex: Lock released');
        }
    }

    /**
     * ロック状態を取得
     */
    isLocked() {
        return this.locked;
    }

    /**
     * ロック期間を取得
     */
    getLockDuration() {
        if (!this.locked || !this.lockedAt) {
            return 0;
        }
        return Date.now() - this.lockedAt;
    }

    /**
     * キューサイズを取得
     */
    getQueueSize() {
        return this.queue.size;
    }
}
```

**変更後の `obsidianClient.js` 使用例:**
```javascript
import { Mutex } from './Mutex.js';

export class ObsidianClient {
    constructor(options = {}) {
        this.mutex = options.mutex || new Mutex();
    }

    async appendToDailyNote(content) {
        await this.mutex.acquire();
        try {
            return this._appendInternal(content);
        } finally {
            this.mutex.release();
        }
    }
}
```

---

### 2. 開放閉鎖の原則（OCP）の改善

#### 2.1 StrategyパターンによるAIプロバイダー拡張

**問題:** 新しいAIプロバイダー追加時に`AIClient`内部を変更する必要がある

**影響範囲:**
- `src/background/aiClient.js`
- 新規ファイル複数

**変更内容:**
- プロバイダーごとに独立したクラスを作成
- Strategyパターンで拡張可能に

**新規ファイル構造:**
```
src/background/ai/
├── providers/
│   ├── ProviderStrategy.js
│   ├── GeminiProvider.js
│   ├── OpenAIProvider.js
│   └── index.js
└── aiClient.js (修正)
```

**新規ファイル: `src/background/ai/providers/ProviderStrategy.js`**
```javascript
/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 */

export class AIProviderStrategy {
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * 要約を生成する
     */
    async generateSummary(content) {
        throw new Error('generateSummary must be implemented');
    }

    /**
     * 接続テストを実行する
     */
    async testConnection() {
        throw new Error('testConnection must be implemented');
    }

    /**
     * プロバイダー名を取得
     */
    getName() {
        throw new Error('getName must be implemented');
    }
}
```

**新規ファイル: `src/background/ai/providers/GeminiProvider.js`**
```javascript
import { AIProviderStrategy } from './ProviderStrategy.js';
import { fetchWithTimeout } from '../../utils/fetch.js';
import { addLog, LogType } from '../../utils/logger.js';

export class GeminiProvider extends AIProviderStrategy {
    constructor(settings) {
        super(settings);
        this.apiKey = settings.geminiApiKey;
        this.model = settings.geminiModel || 'gemini-1.5-flash';
        this.timeoutMs = 30000;
    }

    getName() {
        return 'gemini';
    }

    async generateSummary(content) {
        if (!this.apiKey) {
            return "Error: API key is missing. Please check your settings.";
        }

        const cleanModelName = this.model.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent`;
        const truncatedContent = content.substring(0, 30000);

        const payload = {
            contents: [{
                parts: [{
                    text: `以下のWebページの内容を、日本語で簡潔に要約してください。
                           1文または2文で、重要なポイントをまとめてください。改行しないこと。

                           Content:
                           ${truncatedContent}`
                }]
            }]
        };

        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls: await this._getAllowedUrls()
            }, this.timeoutMs);

            if (!response.ok) {
                return this._handleError(response);
            }

            const data = await response.json();
            return this._extractSummary(data);
        } catch (error) {
            if (error.message.includes('timed out')) {
                return "Error: AI request timed out. Please check your connection.";
            }
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }

    async testConnection() {
        if (!this.apiKey) {
            return { success: false, message: 'Gemini API Key is not set.' };
        }

        try {
            const response = await fetchWithTimeout(
                'https://generativelanguage.googleapis.com/v1beta/models',
                {
                    method: 'GET',
                    headers: { 'x-goog-api-key': this.apiKey },
                    allowedUrls: await this._getAllowedUrls()
                },
                this.timeoutMs
            );

            if (response.ok) {
                return { success: true, message: 'Connected to Gemini API.' };
            }
            return { success: false, message: `Gemini API Error: ${response.status}` };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    async _getAllowedUrls() {
        const { getAllowedUrls } = await import('../../utils/storage.js');
        return getAllowedUrls();
    }

    async _handleError(response) {
        const errorText = await response.text();
        if (response.status === 404) {
            return "Error: Model not found. Please check your AI model settings.";
        }
        return "Error: Failed to generate summary. Please check your API settings.";
    }

    _extractSummary(data) {
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            return data.candidates[0].content.parts[0].text;
        }
        return "No summary generated.";
    }
}
```

**新規ファイル: `src/background/ai/providers/OpenAIProvider.js`**
```javascript
import { AIProviderStrategy } from './ProviderStrategy.js';
import { fetchWithTimeout } from '../../utils/fetch.js';
import { addLog, LogType } from '../../utils/logger.js';

export class OpenAIProvider extends AIProviderStrategy {
    constructor(settings, providerName = 'openai') {
        super(settings);
        this.providerName = providerName;
        this.baseUrl = settings[`${providerName}BaseUrl`] || 'https://api.openai.com/v1';
        this.apiKey = settings[`${providerName}ApiKey`];
        this.model = settings[`${providerName}Model`] || 'gpt-3.5-turbo';
        this.timeoutMs = 30000;
    }

    getName() {
        return this.providerName;
    }

    async generateSummary(content) {
        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        const truncatedContent = content.substring(0, 30000);

        const payload = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
                },
                {
                    role: "user",
                    content: `以下のWebページの内容を、日本語で簡潔に要約してください。
                           1文または2文で、重要なポイントをまとめてください。改行しないこと。

                           Content:
                           ${truncatedContent}`
                }
            ]
        };

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                allowedUrls: await this._getAllowedUrls()
            }, this.timeoutMs);

            if (!response.ok) {
                return "Error: Failed to generate summary. Please check your API settings.";
            }

            const data = await response.json();
            return this._extractSummary(data);
        } catch (error) {
            if (error.message.includes('timed out')) {
                return "Error: AI request timed out. Please check your connection.";
            }
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }

    async testConnection() {
        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/models`;

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers,
                allowedUrls: await this._getAllowedUrls()
            }, this.timeoutMs);

            if (response.ok) {
                return { success: true, message: 'Connected to AI API.' };
            }
            return { success: false, message: `AI API Error: ${response.status}` };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    async _getAllowedUrls() {
        const { getAllowedUrls } = await import('../../utils/storage.js');
        return getAllowedUrls();
    }

    _extractSummary(data) {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        return "No summary generated.";
    }
}
```

**新規ファイル: `src/background/ai/providers/index.js`**
```javascript
export { AIProviderStrategy } from './ProviderStrategy.js';
export { GeminiProvider } from './GeminiProvider.js';
export { OpenAIProvider } from './OpenAIProvider.js';
```

**修正後の `src/background/aiClient.js`**
```javascript
import { GeminiProvider, OpenAIProvider } from './ai/providers/index.js';
import { LocalAIClient } from './localAiClient.js';
import { getSettings, StorageKeys } from '../utils/storage.js';

/**
 * AI Client
 * Strategyパターンによるプロバイダー拡張
 */
export class AIClient {
    constructor() {
        this.providers = new Map();
        this.localAiClient = new LocalAIClient();
        this.registerDefaultProviders();
    }

    /**
     * デフォルトプロバイダーを登録
     */
    registerDefaultProviders() {
        this.registerProvider('gemini', GeminiProvider);
        this.registerProvider('openai', (settings) => new OpenAIProvider(settings, 'openai'));
        this.registerProvider('openai2', (settings) => new OpenAIProvider(settings, 'openai2'));
    }

    /**
     * プロバイダーを登録
     */
    registerProvider(name, providerFactory) {
        this.providers.set(name, providerFactory);
    }

    /**
     * プロバイダーを取得
     */
    async getProvider() {
        const settings = await getSettings();
        const providerName = settings[StorageKeys.AI_PROVIDER] || 'gemini';

        const providerFactory = this.providers.get(providerName);
        if (!providerFactory) {
            throw new Error(`Unknown provider: ${providerName}`);
        }

        const provider = typeof providerFactory === 'function'
            ? providerFactory(settings)
            : new providerFactory(settings);

        return provider;
    }

    /**
     * 要約を生成
     */
    async generateSummary(content) {
        const provider = await this.getProvider();
        return provider.generateSummary(content);
    }

    /**
     * 接続テスト
     */
    async testConnection() {
        const provider = await this.getProvider();
        return provider.testConnection();
    }

    /**
     * ローカルAIで要約
     */
    async summarizeLocally(content) {
        return this.localAiClient.summarize(content);
    }

    /**
     * ローカルAIの利用可能性確認
     */
    async getLocalAvailability() {
        return this.localAiClient.getAvailability();
    }
}
```

---

### 3. インターフェース分離の原則（ISP）の改善

#### 3.1 インターフェース定義の追加

**問題:** 明確なインターフェース定義が存在しない

**影響範囲:**
- 新規ファイル: `src/background/interfaces/`
- 既存クラス: `ObsidianClient`, `AIClient`, `RecordingLogic`

**変更内容:**
- コアコンポーネントに対してインターフェースを定義

**新規ファイル構造:**
```
src/background/interfaces/
├── IObsidianClient.js
├── IAIClient.js
├── IRecordingLogic.js
└── index.js
```

**新規ファイル: `src/background/interfaces/IObsidianClient.js`**
```javascript
/**
 * ObsidianClientインターフェース
 * Obsidianとの通信に関する契約を定義
 */
export class IObsidianClient {
    /**
     * デイリーノートにコンテンツを追加
     * @param {string} content - 追加するコンテンツ
     * @returns {Promise<void>}
     */
    async appendToDailyNote(content) {
        throw new Error('appendToDailyNote must be implemented');
    }

    /**
     * 接続をテスト
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
        throw new Error('testConnection must be implemented');
    }
}
```

**新規ファイル: `src/background/interfaces/IAIClient.js`**
```javascript
/**
 * AIClientインターフェース
 * AI関連の処理に関する契約を定義
 */
export class IAIClient {
    /**
     * 要約を生成
     * @param {string} content - 要約対象のコンテンツ
     * @returns {Promise<string>}
     */
    async generateSummary(content) {
        throw new Error('generateSummary must be implemented');
    }

    /**
     * 接続をテスト
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
        throw new Error('testConnection must be implemented');
    }

    /**
     * ローカルAIで要約
     * @param {string} content
     * @returns {Promise<{success: boolean, summary: string|null, error?: string}>}
     */
    async summarizeLocally(content) {
        throw new Error('summarizeLocally must be implemented');
    }

    /**
     * ローカルAIの利用可能性確認
     * @returns {Promise<string>}
     */
    async getLocalAvailability() {
        throw new Error('getLocalAvailability must be implemented');
    }
}
```

**新規ファイル: `src/background/interfaces/IRecordingLogic.js`**
```javascript
/**
 * RecordingLogicインターフェース
 * 記録処理に関する契約を定義
 */
export class IRecordingLogic {
    /**
     * 記録処理を実行
     * @param {Object} data - 記録データ
     * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
     */
    async record(data) {
        throw new Error('record must be implemented');
    }

    /**
     * プレビュー記録処理
     * @param {Object} data - 記録データ
     * @returns {Promise<Object>}
     */
    async recordWithPreview(data) {
        throw new Error('recordWithPreview must be implemented');
    }
}
```

**修正後の実装クラス例:**
```javascript
// obsidianClient.js
import { IObsidianClient } from './interfaces/IObsidianClient.js';

export class ObsidianClient extends IObsidianClient {
    async appendToDailyNote(content) {
        // 既存の実装
    }

    async testConnection() {
        // 既存の実装
    }
}

// recordingLogic.js
import { IRecordingLogic } from './interfaces/IRecordingLogic.js';
import { IObsidianClient } from './interfaces/IObsidianClient.js';
import { IAIClient } from './interfaces/IAIClient.js';

/**
 * @param {IObsidianClient} obsidianClient
 * @param {IAIClient} aiClient
 */
export class RecordingLogic extends IRecordingLogic {
    constructor(obsidianClient, aiClient) {
        this.obsidian = obsidianClient;
        this.aiClient = aiClient;
    }

    async record(data) {
        // 既存の実装
    }

    async recordWithPreview(data) {
        // 既存の実装
    }
}
```

---

### 4. 依存性逆転の原則（DIP）の改善

#### 4.1 依存性注入パターンの導入

**問題:** 具体的なクラスに直接依存している

**影響範囲:**
- `src/background/service-worker.js`
- `src/background/recordingLogic.js`

**変更内容:**
- 依存性をコンストラクタ経由で注入する

**修正後の `service-worker.js`**
```javascript
import { IObsidianClient } from './interfaces/IObsidianClient.js';
import { IAIClient } from './interfaces/IAIClient.js';
import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';

/**
 * Service Workerのコンテキスト
 */
class ServiceWorkerContext {
    constructor() {
        // 依存関係の注入
        this.dependencies = {
            obsidian: new ObsidianClient(),
            aiClient: new AIClient(),
            tabCache: new TabCache()
        };

        // RecordingLogicにはインターフェース経由で依存を注入
        this.recordingLogic = new RecordingLogic(
            this.dependencies.obsidian,  // IObsidianClient
            this.dependencies.aiClient   // IAIClient
        );
    }

    // テスト用: 依存関係を上書き可能
    setDependency(name, instance) {
        this.dependencies[name] = instance;
    }

    getRecordingLogic() {
        return this.recordingLogic;
    }

    getTabCache() {
        return this.dependencies.tabCache;
    }

    getObsidian() {
        return this.dependencies.obsidian;
    }

    getAIClient() {
        return this.dependencies.aiClient;
    }
}

// グローバルインスタンス
const context = new ServiceWorkerContext();

// 使用例
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const process = async () => {
        // Contextから依存関係を取得
        const recordingLogic = context.getRecordingLogic();
        const tabCache = context.getTabCache();

        // 処理...
    };

    process();
    return true;
});
```

---

## 実装順序

以下の順序で段階的に実装を進めることを推奨します：

| フェーズ | タスク | 優先度 |
|---------|--------|--------|
| 1 | TabCacheの分離 | 高 |
| 2 | Mutexの分離 | 高 |
| 3 | Strategyパターンの導入 | 中 |
| 4 | インターフェース定義 | 中 |
| 5 | 依存性注入 | 低 |

**フェーズ1-2:** コードの分割整理（SRP改善）
**フェーズ3-4:** 構造の改善（OCP, ISP改善）
**フェーズ5:** テスト容易性の向上（DIP改善）

---

## テスト戦略

各フェーズ完了後に、既存テストを更新し、新規コンポーネントのテストを追加します：

1. **TabCache**: 単体テストを作成（初期化、追加、取得、削除）
2. **Mutex**: 排他制御の動作検証
3. **AIプロバイダー**: 各プロバイダーの単体テスト
4. **インターフェース**: モックによるインテグレーションテスト

---

## 後続タスク

このプランが承認された後、`writing-plans`スキルを呼び出して詳細な実装計画を作成します。

---

## 実装完了ステータス (2026-02-14)

| フェーズ | タスク | ステータス | コミット |
|---------|--------|-----------|---------|
| 1 | TabCacheの分離 | ✅ 完了 | `bc17f97` |
| 2 | Mutexの分離 | ✅ 完了 | `bc17f97` |
| 3 | Strategyパターンの導入 | ✅ 完了 | `2d67fce` |
| 4 | インターフェース定義 | ✅ 完了 | `fa7e062` |
| 5 | 依存性注入 | ✅ 完了 | `fa7e062` |

### 実装結果

**新規ファイル:**
- `src/background/Mutex.js` - 排他制御クラス（114行）
- `src/background/ServiceWorkerContext.js` - 依存性注入コンテキスト（181行）
- `src/background/tabCache.js` - タブキャッシュクラス（124行）
- `src/background/interfaces/index.js` - モジュールインターフェース定義（227行）
- `src/background/ai/providers/` - AIプロバイダーStrategyパターン（305行）

**変更統計:**
- 15ファイル変更
- +1339行（追加）、-413行（削除）
- 純増: +926行

### SOLID原則への改善結果

| 原則 | 改善前 | 改善後 |
|------|--------|--------|
| S（単一責任） | △ Service Worker等が複数の責任有 | ✅ TabCache、Mutexが分離 |
| O（開放閉鎖） | × 新規プロバイダー追加時に修正 | ✅ Strategyパターンで拡張可能 |
| L（リスコフ置換） | N/A | N/A |
| I（インターフェース分離） | △ インターフェース未定義 | ✅ ITabCache等の定義完了 |
| D（依存性逆転） | × 具体的クラスに依存 | ✅ ServiceWorkerContextで注入 |

### テスト結果

- **TabCache**: 22 tests passed
- **Mutex Map**: 4 tests passed
- **AI Client**: 11 tests passed
- 全体: 1015 passed, 18 failed（失敗は piiSanitizer.test.js の既存問題）