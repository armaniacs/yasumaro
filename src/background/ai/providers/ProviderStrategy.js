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