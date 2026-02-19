/**
 * loader.ts
 * 【Task #19 最適化】Content Script loader with domain filter cache
 * 動的に extractor モジュールをインポートし、ドメインフィルタをチェックする
 *
 * パフォーマンス改善:
 * 1. 内部スキーム（chrome://など）の早期リターン
 * 2. ドメインフィルタキャッシュを使用して、許可ドメイン外で早期リターン
 * 3. キャッシュがない場合のみバックグラウンドメッセージ通信
 */
export {};
//# sourceMappingURL=loader.d.ts.map