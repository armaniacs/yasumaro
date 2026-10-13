# PBI: ServiceTokens 残骸 union を削除して設計規約と再同期する

- 種別: refactor
- RICE: 7.0（R7 × I1 × C1.0 / E1.0）
- 依存: なし
- バッチ: W1

## ユーザーストーリー

保守担当者として、compositionManifest に keys union が存在しない状態であってほしい。なぜなら DESIGN_SPECIFICATIONS が「keep in sync する union は廃止」と明言しているのに残骸が drift しながら生存しており、新エントリ追加時に無用な認知負荷と混乱の元になるから。

## 背景（現状）

- `src/background/serviceContainer.ts:14-38` — `ServiceTokens`（21キー const）+ `ServiceKey = keyof typeof ServiceTokens | (string & {})`。production 参照は `ServiceKey` 型定義のみで、`(string & {})` により実質 string（型安全性に寄与ゼロ）
- `src/background/__tests__/serviceContainer-coverage.test.ts` — 内容の整合を検査するテストが存在する可能性
- DESIGN_SPECIFICATIONS.md §2.2 — compositionManifest について「**there is no separate register() block, keys union, or subset-check type to keep in sync**」と明言
- drift 実証: `pendingSqliteQueue` / `offlineNetworkQueue` / `sessionAlarmService` / `deferredMigrationRunner` / `alarmRegistry` の 5 キーが ServiceTokens 未収録で manifest には存在

「keep in sync する union」が sync されずに腐った実例。dead seam + 規約逸脱。

## BDD 受け入れシナリオ

```gherkin
Scenario: 新 manifest エントリ追加時に union を触らない
  Given ServiceTokens が削除されている
  When createBackgroundServices に新しいコンテナエントリを追加する
  Then serviceContainer.ts の編集は不要である

Scenario: コンテナの動作は変更前と同一
  Given 既存の register/resolve/override 呼び出し
  When コンテナを操作する
  Then 未登録キーの resolve は例外、singleton メモ化、override は変更前と同一
```

## 受け入れ基準

- [x] `ServiceTokens` 定数を削除する
- [x] `ServiceKey` を `type ServiceKey = string` に縮約する
- [x] serviceContainer-coverage.test.ts の ServiceTokens 参照をリテラルキーに置換する
- [x] ServiceTokens への production 参照が 0 件になることを `rg` で確認
- [x] 既存コンテナテストが green（動作不変）

## テスト戦略

- unit: `src/background/__tests__/serviceContainer*.test.ts` — リテラルキー置換（既に `c.register('counter', ...)` 等のリテラル併用済み）
- 挙動不変: register/resolve/override の意味論は変更しない

## 見積もり

1.0 SP

## 技術的考慮事項

- 削除一発の規範化。挙動不変
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `serviceContainer.ts`: ServiceTokens 削除 + ServiceKey 縮約
2. coverage テスト置換 → `npx vitest run src/background/__tests__/serviceContainer` で検証
3. `rg -n "ServiceTokens" src/` で 0 件確認

### 落とし穴

- 他ファイルが ServiceTokens を import していないことを先に確認（production 参照は型のみと裏取り済みだが、テストの参照は要確認）

## Definition of Done

- [x] `ServiceTokens` がリポジトリから消滅
- [x] `ServiceKey = string` に縮約
- [x] `npx vitest run src/background` が green
- [x] DESIGN_SPECIFICATIONS.md §2.2 の記述と実装が一致
- [x] ロールバック不要（規範化）
