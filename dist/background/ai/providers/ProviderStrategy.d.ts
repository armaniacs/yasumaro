/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 */
import { Settings } from '../../../utils/storage.js';
export interface AIProviderConnectionResult {
    success: boolean;
    message: string;
}
export declare abstract class AIProviderStrategy {
    protected settings: Settings;
    constructor(settings: Settings);
    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    abstract generateSummary(content: string, tagSummaryMode?: boolean): Promise<string>;
    /**
     * 接続テストを実行する
     */
    abstract testConnection(): Promise<AIProviderConnectionResult>;
    /**
     * プロバイダー名を取得
     */
    abstract getName(): string;
}
//# sourceMappingURL=ProviderStrategy.d.ts.map