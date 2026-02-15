/**
 * ublockParser/options.ts
 * uBlock Origin形式フィルターパーサーのオプションパース
 *
 * 【機能概要】: uBlock Origin形式のオプション文字列をパースし、内部データ構造に変換
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および uBlock Origin標準構文に基づく実装
 */
export interface OptionValues {
    domains?: string[];
    negatedDomains?: string[];
    thirdParty?: boolean;
    firstParty?: boolean;
    important?: boolean;
    matchCase?: boolean;
}
/**
 * 【ヘルパー関数】: ドメインオプションのドメインリストをパース
 * 【改善内容】: parseOptionsからドメイン処理ロジックを分離して単一責任原則適用
 * 【設計方針】: | 区切りのドメインリストを配列に変換し、空文字をフィルタ
 * 【処理効率化】: filterによる空文字排除で確実な配列生成
 * 【可読性向上】: ドメイン処理ロジックが独立して明確
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載されるドメイン構文
 * @param {string} domainValue - `example.com|test.com` 形式のドメイン値
 * @returns {string[]} - クリーンなドメイン配列（空文字は除外）
 */
export declare function parseDomainList(domainValue: string): string[];
/**
 * ルールのオプション部分をパース
 *
 * 【機能概要】: uBlock Origin形式のオプション文字列をパースし、内部データ構造に変換
 * 【改善内容】:
 *   - ヘルパー関数parseDomainListでドメイン処理を分離
 *   - 定数OPTION_TYPESでハードコードを削除
 *   - シンプルなif-elseチェーンで可読性向上
 * 【設計方針】: カンマ区切りのオプションを分割し、各オプションタイプごとに適切に処理
 * 【パフォーマンス】: O(n)のループ処理、各オプションに対する定数時間処理
 * 【保守性】: 定数とヘルパー関数の変更が一箇所で適用
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および uBlock Origin標準構文に基づく実装
 * @param {string} optionsString - オプション文字列（`domain=example.com,3p,important` 等）
 * @returns {OptionValues} - パースされたオプションオブジェクト
 */
export declare function parseOptions(optionsString: string): OptionValues;
/**
 * ルール行からオプション部分を抽出してパース
 * 【設計方針】: buildRuleObjectからオプション処理を分離して単一責任原則適用
 * 【処理効率化】: indexOfとsubstringで効率的にオプション部分を抽出
 * 【可読性向上】: オプション処理ロジックが独立して明確
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載されるオプション構文
 * @param {string} line - トリムされたルール行
 * @returns {OptionValues} - パースされたオプションオブジェクト
 */
export declare function parseRuleOptions(line: string): OptionValues;
//# sourceMappingURL=options.d.ts.map