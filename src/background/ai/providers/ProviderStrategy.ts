/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 */

import { Settings } from '../../../utils/storage.js';

export interface AIProviderConnectionResult {
    success: boolean;
    message: string;
}

export abstract class AIProviderStrategy {
    protected settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    /**
     * 要約を生成する
     */
    abstract generateSummary(content: string): Promise<string>;

    /**
     * 接続テストを実行する
     */
    abstract testConnection(): Promise<AIProviderConnectionResult>;

    /**
     * プロバイダー名を取得
     */
    abstract getName(): string;
}