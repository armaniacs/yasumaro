/**
 * ublockParser/parsing.ts
 * uBlock Origin形式フィルターパーサーのパーシングロジック
 *
 * 【機能概要】: uBlock Origin形式のドメインフィルターをパースし、内部データ構造に変換
 * 【実装方針】: 入力値検証とパターンマッチングによる安全なパース処理
 * 【テスト対応】: ソース `src/utils/__tests__/ublockParser.test.js` の29テストケースに対応
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および plan/UII/10-data-structures.md に基づく実装
 */
import { UblockRule } from './transform.js';
/**
 * uBlock形式の単一フィルタールールをパース
 *
 * 【改善内容】:
 *   - ヘルパー関数への分割で可読性向上
 *   - isValidStringによる一貫した入力検証
 *   - 定数使用によるハードコード削除
 * 【設計方針】: ||hostname^ @@||hostname^ 形式のドメインブロックルールをパース
 * 【パフォーマンス】: 各ヘルパー関数が単一責任を持つため効率的
 * 【保守性】: 各処理が独立しているため変更が容易
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される基本機能
 * @param {string} line - フィルタールールの1行
 * @returns {UblockRule|null} - パースされたルール（無効ならnull）
 */
export declare function parseUblockFilterLine(line: string): UblockRule | null;
//# sourceMappingURL=parsing.d.ts.map