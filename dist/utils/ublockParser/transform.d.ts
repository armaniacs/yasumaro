/**
 * ublockParser/transform.ts
 * uBlock Origin形式フィルターパーサーのデータ変換・構築関数
 *
 * 【機能概要】: ルールID生成、ルールオブジェクト構築、ルールセット生成を提供
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造
 */
import { OptionValues } from './options.js';
export { parseDomainList } from './options.js';
export interface UblockRule {
    id: string;
    rawLine: string;
    type: string;
    domain: string;
    pattern: string;
    options: OptionValues;
    originalLine?: string;
}
export interface UblockRules {
    blockRules: UblockRule[];
    exceptionRules: UblockRule[];
    metadata: {
        source: string;
        importedAt: number;
        lineCount: number;
        ruleCount: number;
    };
}
/**
 * ルールの一意IDを生成
 *
 * 【設計方針】: FNV-1aハッシュの簡易版で一意性を確保
 * 【パフォーマンス】: O(n)の単純なハッシュ関数、十分な速度
 * 【保守性】: 注記で将来のSHA-256移行可能性を明記
 * 🟡 信頼性レベル: 一般的なID生成機能から妥当な推測
 * @param {string} rawLine - 元のルール行
 * @returns {string} - 一意ID
 */
export declare function generateRuleId(rawLine: string): string;
/**
 * 【ヘルパー関数】: ルールオブジェクトを構築
 * 【設計方針】: オブジェクト構築ロジックを分離して可読性向上
 * 【処理効率化】: 一度のオブジェクト生成で効率的
 * 【可読性向上】: プロパティごとの役割が明確
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造
 * @param {string} trimmedLine - トリムされた元の行
 * @param {string} type - ルールタイプ
 * @param {string} domain - ドメイン
 * @returns {UblockRule} - UblockRuleオブジェクト
 */
export declare function buildRuleObject(trimmedLine: string, type: string, domain: string): UblockRule;
/**
 * 【ヘルパー関数】: 空のルールセットを生成
 * 【設計方針】: 空ルールセット生成を共通化してDRY原則適用
 * 【処理効率化】: 関数呼び出しのオーバーヘッドは最小限
 * 【再利用性】: parseUblockFilterListの初期化とエラー時の返却で使用
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造
 * @returns {UblockRules} - 空のUblockRulesオブジェクト
 */
export declare function createEmptyRuleset(): UblockRules;
//# sourceMappingURL=transform.d.ts.map