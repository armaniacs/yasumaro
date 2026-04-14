/**
 * contentExtractor.ts
 * 【機能概要】: Webページのメインコンテンツを抽出し、ノイズ（ナビゲーション、ヘッダー等）を除去する
 * 【設計方針】:
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 *   - Readabilityアルゴリズムの簡易実装
 *   - ベストエフォートで抽出し、失敗時はフォールバック
 *   - 最大文字数制限の維持
 *
 * 【リファクタリング履歴】: 単一ファイル（912行）からモジュール分割へ実装
 *
 * 新しいモジュール構成:
 * - contentExtractor/types.ts              - 型定義（ExtractResult, CleanseCallback）
 * - contentExtractor/classifier.ts         - 要素分類（除外判定・アジアコンテンツ判定）
 * - contentExtractor/scoring.ts            - スコア計算・候補探索
 * - contentExtractor/textExtraction.ts      - テキスト抽出
 * - contentExtractor/index.ts              - オーケストレーター + 再エクスポート
 * 🟢
 */

// 新しいモジュール構造からパブリックAPIを再エクスポート
export * from './contentExtractor/index.js';