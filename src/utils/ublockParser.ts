/**
 * ublockParser.js
 * uBlock Origin形式フィルターパーサー（リファクタリング後）
 *
 * 【機能概要】: 新しいモジュール構造からパブリックAPIを再エクスポート
 * 【リファクタリング履歴】: 単一ファイル（880行）からモジュール分割へ実装
 *
 * 新しいモジュール構成:
 * - src/utils/ublockParser/index.js - メインエントリーポイント
 * - src/utils/ublockParser/constants.js - 定数定義
 * - src/utils/ublockParser/cache.js - キャッシュ管理
 * - src/utils/ublockParser/validation.js - バリデーション関数
 * - src/utils/ublockParser/transform.js - データ変換・構築関数
 * - src/utils/ublockParser/options.js - オプションパース
 * - src/utils/ublockParser/parsing.js - パーシングロジック
 */

// 新しいモジュール構造からパブリックAPIを再エクスポート
export * from './ublockParser/index.js';