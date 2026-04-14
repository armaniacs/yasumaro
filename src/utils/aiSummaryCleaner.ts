/**
 * AI要約クリーニング
 * 【機能概要】: AI要約に不要な情報を含む要素を削除する
 * 【設計方針】:
 *   - AI要約（generateSummary）に渡す前に適用
 *   - 画像alt属性、メタデータ、広告、ナビゲーション、ソーシャルウィジェットを削除
 *   - JSON-LD構造化データ、遅延読み込みコンテンツ、スキップリンク等を削除
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 *
 * 【リファクタリング履歴】: 単一ファイル（2103行）からモジュール分割へ実装
 *
 * 新しいモジュール構成:
 * - aiSummaryCleaner/types.ts          - 型定義
 * - aiSummaryCleaner/patterns.ts        - パターン定数
 * - aiSummaryCleaner/helpers.ts         - ヘルパー関数
 * - aiSummaryCleaner/stripCore.ts       - コア11個の_strip関数
 * - aiSummaryCleaner/stripExtended.ts   - 拡張15個の_strip関数
 * - aiSummaryCleaner/countTargets.ts    - カウント専用関数
 * - aiSummaryCleaner/index.ts           - オーケストレーター + 再エクスポート
 * 🟢
 */

// 新しいモジュール構造からパブリックAPIを再エクスポート
export * from './aiSummaryCleaner/index.js';