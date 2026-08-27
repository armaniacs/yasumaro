# PBI: background/migration カバレッジ 90% 達成

## ユーザーストーリー
開発者として、`background/migration` カバレッジを 87.82% → 90% 以上に引き上げたい、なぜなら `migrationState 57%` / `serviceContainer 73%` が初回マイグレーション失敗時の分岐を未カバーでリリース時のデータ不整合を見逃すから。

## 優先度
- 順位: 4 / 4
- RICEスコア: 150（Reach=30 / Impact=1 / Confidence=75% / Effort=0.15）
- 根拠: マイグレーションは初回起動の 1 回のみ (Reach=30)。残り 2pt で 90% 到達だが確信度やや低。`migrationState` の `chrome.storage` 分岐は `vitest.setup.ts` の mock で再現可能で Effort 0.15。

## なぜなぜ分析
- なぜ低いか: `migrationState.ts:57%` の未達は `chrome.storage.local.get` の `undefined` / `version` 不一致の 2分岐、`serviceContainer` の `override` 未達
- なぜテストしなかったか: 既存 `migrations-comprehensive.test.ts` は offscreen 側の `runMigrations` をテストし background 側の `migrationState` は対象外だった
- 解: `migrationState` に `InMemory` / `ChromeStorageAdapter` の 2 adapter で分岐テスト、`serviceContainer` の `has/override` を `InMemory` で検証

## BDD受け入れシナリオ
Scenario: ハッピーパス — マイグレーションが正常に完了する
  Given `migrationState` のバージョンが最新でない
  When `runMigrations` を呼ぶ
  Then `version` が更新され `legacyMigration` が実行される

Scenario: エッジケース — storage が undefined の場合は初期化される
  Given `chrome.storage.local.get` が `undefined` を返す
  When `migrationState.getVersion` を呼ぶ
  Then デフォルトバージョンが返りマイグレーションが走る

## 受け入れ基準
- [x] `src/background/migration/migrationState.ts` の Statements が 90% 以上に到達する (現在 57%)
- [x] `src/background/serviceContainer.ts` の Statements が 85% 以上に到達する (現在 73%、目標 90% に近づく)
- [x] `background/migration` ディレクトリ全体の Statements が 90% 以上になる
- [x] `npx vitest run --coverage` で All files Branches が 82% → 84% 以上に改善する

## テスト戦略
- 単体: `migrationState` の `getVersion` / `setVersion` の `undefined` / `number` / `string` 分岐テスト。`serviceContainer` の `register` / `resolve` / `has` / `override` の 4分岐テスト
- 統合: `legacyMigration` + `opfsRecovery` の結合で `chrome.storage` の `get/set` を実 mock で検証
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npx vitest run --coverage` で該当ディレクトリ 90% 以上を達成
- [x] コードレビュー完了
- [x] ドキュメント更新済み
