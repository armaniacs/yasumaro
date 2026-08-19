# PBI: Delete the RecordingCache static facade

## ユーザーストーリー
開発者として、`RecordingCacheInstance` を依存性注入で受け取る状態がほしい。なぜならグローバル状態を持たないモジュールはテスト時に独立したインスタンスを使用でき、並列テストやモック置換が容易になるから。

## 優先度
- 順位: 03 / 05
- RICEスコア: 4.50（Reach=5 / Impact=1.5 / Confidence=90% / Effort=1.5 人週）
- 根拠: 14 箇所の静的メソッド呼び出しを DI に移行することで、グローバル状態が排除されテスト可能性が大きく向上。Pipeline 側は既に `RecordingCacheInstance` を使用しており、残りの移行は比較的明確。

## BDD受け入れシナリオ
Scenario: すべての呼び出し元が RecordingCacheInstance を DI で受け取る
  Given `headerDetector`、`tabEventHandlers`、`service-worker` などの各モジュールがコンストラクタまたはファクトリで `RecordingCacheInstance` を受け取る
  When 任意のキャッシュ操作（`getSettingsWithCache`、`getPrivacyCache` など）を実行する
  Then グローバルな `RecordingCache` 静的メソッドを介さずに動作し、テスト時に独立したインスタンスを注入できる

Scenario: 静的ファサード削除後も既存テストがパスする
  Given `RecordingCache` 静的クラスが削除されている
  When 既存のテストスイートを実行する
  Then 型エラーが発生せず、すべてのテストがパスする

## 受け入れ基準
- [ ] `RecordingCache` 静的クラスが削除されている
- [ ] 14 箇所の静的メソッド呼び出しがすべて `RecordingCacheInstance` のインジェクションに置き換わっている
- [ ] 静的メソッド呼び出しが新規コードに追加されていない
- [ ] `createBackgroundServices.ts` で `RecordingCacheInstance` が生成され、必要なモジュールに配布されている
- [ ] 生成される `RecordingCacheInstance` と `SessionStore` は同じストレージバックエンドインスタンスを共有する
- [ ] テストでは `InMemoryRecordingCacheStore` を注入し、グローバル状態を参照しない
- [ ] 既存の `recordingCache.test.ts` が変更なしでパスする

## テスト戦略
- 単体: `RecordingCacheInstance` の既存テストがパスすること
- 統合: `headerDetector`、`tabEventHandlers` などの各モジュールが `RecordingCacheInstance` を受け取って動作することをテスト
- E2E: 実際のページ閲覧→録音→キャッシュ反映の流れが正常に動作

## リスクと留意事項
- `headerDetector` や `tabEventHandlers` は Service Worker 起動時に生成されるため、コンストラクタ引数の追加は `service-worker.ts` の初期化順序に影響する
- `RecordingCache` 静的クラスを削除すると、テストファイルの import も修正する必要がある
- `SessionStore` インスタンスの共有を誤ると、SW 再起動時のキャッシュ復元が失敗する可能性がある

## 見積もり
1.5 ストーリーポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（該当する場合のみ）
- [ ] `RecordingCache` 静的クラスの削除が完了している
