/**
 * @file src/popup/ublockImport.ts
 * uBlockインポートUIロジック（リファクタリング後）
 *
 * 【リファクタリング履歴】: 単一ファイル（597行）からモジュール分割へ実装
 *
 * 新しいモジュール構成:
 * - src/popup/ublockImport/index.js - メインエントリーポイント
 * - src/popup/ublockImport/fileReader.js - ファイル読み込み処理
 * - src/popup/ublockImport/urlFetcher.js - URL読み込み処理
 * - src/popup/ublockImport/rulesBuilder.js - 変換ロジック
 * - src/popup/ublockImport/validation.js - バリデーション
 * - src/popup/ublockImport/sourceManager.js - ソース管理
 * - src/popup/ublockImport/uiRenderer.js - UI操作
 */

// 新しいモジュール構造からパブリックAPIを再エクスポート
export * from './ublockImport/index.js';