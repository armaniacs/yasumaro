/**
 * ublockParser/transform.ts
 * uBlock Origin形式フィルターパーサーのデータ変換・構築関数
 *
 * 【機能概要】: ルールID生成、ルールオブジェクト構築、ルールセット生成を提供
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造
 */
import { DEFAULT_METADATA, NULL_RULE_ID } from './constants.js';
import { parseRuleOptions } from './options.js';
export { parseDomainList } from './options.js';
// ============================================================================
// ID生成
// ============================================================================
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
export function generateRuleId(rawLine) {
    // 【入力値検証】: null/undefinedの場合は固定値を返す 🟡
    if (rawLine == null || typeof rawLine !== 'string') {
        return NULL_RULE_ID;
    }
    // 【簡易ハッシュ】: FNV-1aハッシュの簡易版を使用 🟡
    // 【セキュリティ】: セキュアなハッシュではなく、識別用のみ 🟡
    // 【注記】: 将来的にはSHA-256への移行を推奨（Web Crypto API等）
    let hash = 0;
    for (let i = 0; i < rawLine.length; i++) {
        const char = rawLine.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit整数に変換
    }
    // 【IDフォーマット】: ハッシュ値をハイフン区切りのUUID形式に変換
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12) || '0000'}-${hex.substring(12, 16) || '0000'}-${hex.substring(16, 20) || '0000'}-${hex.substring(20, 32) || '000000000000'}`.substring(0, 36);
}
// ============================================================================
// ドメインリストパース
// ============================================================================
// 注意: parseDomainList は options.js で定義されています
// これは parseOptions 関数から内部的に使用されるため
// ============================================================================
// ルールオブジェクト構築
// ============================================================================
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
export function buildRuleObject(trimmedLine, type, domain) {
    // 【パターン生成】: マッチング用パターンを作成
    // 【注記】: Greenフェーズではドメインをそのまま使用、UF-103で正規表現処理予定 🟡
    const pattern = domain;
    // 【ルール構造】: UblockRuleオブジェクトを構築
    return {
        id: generateRuleId(trimmedLine), // 【ID生成】: ルールの一意識別子
        rawLine: trimmedLine, // 【元の行】: エクスポート用に保持
        type, // 【ルール種類】: block または exception
        domain, // 【ドメインパターン】: 抽出されたドメイン
        pattern, // 【マッチングパターン】: 内部処理用
        options: parseRuleOptions(trimmedLine) // 【オプション】: パースされたオプション
    };
}
// ============================================================================
// ルールセット生成
// ============================================================================
/**
 * 【ヘルパー関数】: 空のルールセットを生成
 * 【設計方針】: 空ルールセット生成を共通化してDRY原則適用
 * 【処理効率化】: 関数呼び出しのオーバーヘッドは最小限
 * 【再利用性】: parseUblockFilterListの初期化とエラー時の返却で使用
 * 🟢 信頼性レベル: plan/UII/10-data-structures.md に記載されるデータ構造
 * @returns {UblockRules} - 空のUblockRulesオブジェクト
 */
export function createEmptyRuleset() {
    return {
        blockRules: [],
        exceptionRules: [],
        metadata: {
            source: DEFAULT_METADATA.SOURCE,
            importedAt: Date.now(),
            lineCount: 0,
            ruleCount: 0
        }
    };
}
//# sourceMappingURL=transform.js.map