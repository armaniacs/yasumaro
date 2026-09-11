# PBI 06: SqliteStatus の SSOT 化（legacy パス定数統合 + enrichment allSettled + 型集約）

## ユーザーストーリー

診断パネルで SQLite 状態を確認する利用者・開発者として、status の各フィールドがどこから来るかが 1 箇所で分かり、旧 DB 存在プローブが環境差で silently 失敗しないことを知りたい。なぜなら現状 6 モジュールを跨いで理解する必要があり、enrichment は 1 つでも落ちると全 extras が消えるから。

## 優先度

- 順位: 06 / 9
- RICE スコア: 12.8（Reach=4 / Impact=2 / Confidence=80% / Effort=0.5 人週）
- 根拠（2026-09-11 診断）:
  - legacy パス定数の drift: `src/offscreen/sqliteMessageHandlers.ts:138-163`（OLD_OPFS_POOL_DIR/OLD_OPFS_DB_FILENAME/OLD_IDB_NAME + 「must match」コメント）· `opfsMigrationV2Reader.ts:18-19`（OLD_POOL_DIR/OLD_DB_FILENAME）· `sqliteEngineContext/migrationBackup.ts:136-148`（OLD_IDB_NAME + 「do NOT change」）· `diagnosticsPanel.ts:223-291`（インライン 5 つ目）— 名前 3 流儀・計 4 ファイル
  - `handleStatus`（sqliteMessageHandlers.ts:165-196）: `Promise.all` で 1 つでも throw すると catch で全 extras 消滅（fail-whole）。`oldIdbDbExists`（:156-163）は `indexedDB.databases` 未定義環境で silent false
  - interface の 2 重: `offscreenGateway.ts:215-224` の `status()/getStatus()` dual API、`sqliteValidators.ts:101-112` の `decodeStatusExtras` 分離、`StorageBackend.StatusResult`（:54-63）に extras フィールド無し（`...result` spread で未型付拡張）

## BDD 受け入れシナリオ

```gherkin
Scenario: enrichment の一部が失敗しても status は残りの extras を返す
  Given chrome.storage の読みが reject する環境
  When  STATUS を要求する
  Then  migration フラグ等の他の extras は返る（fail-whole で全消滅しない）

Scenario: legacy パス定数は 1 箇所で定義される
  Given SqliteStatus モジュールが legacy パス定数を所有する
  When  grep で旧パス文字列 "yasumaro-opfs" 等を検索する
  Then  定義は SqliteStatus 1 箇所のみで、他は import 参照である

Scenario: diagnosticsPanel は定数を直接書かない
  Given 診断パネルが migration セクションを描画する
  When  ラベルを組み立てる
  Then  パスは SqliteStatus の定数から取得される
```

## 受け入れ基準

- [x] `SqliteStatus` モジュール新設: 型（base + extras 全フィールド）・legacy パス定数（1 箇所）・enrichment 関数（allSettled + `indexedDB.databases` feature-detect フォールバック）を所有
- [x] `sqliteMessageHandlers.handleStatus` が enrichment 関数に委譲し、legacy 定数のローカル複製を削除
- [x] `opfsMigrationV2Reader` / `migrationBackup` / `diagnosticsPanel` が定数を import する（同一ソース参照）
- [x] gateway dual API（status/getStatus）と `decodeStatusExtras` の分離を 1 本化
- [x] offscreen / messaging / dashboard 関連テスト green

## テスト戦略

- 単体: enrichment の部分失敗（allSettled）・feature-detect フォールバック
- drift ガード: legacy パス定数が 1 箇所であることを grep ベースのガードテストで固定
- 既存: STATUS 関連テスト（handleStatus / gateway / diagnostics）green

## 見積もり

M（0.5 人週）。種別: refactor（+ fail-whole 修正を含む fix）。

## 実装アプローチ

1. `src/offscreen/sqliteStatus.ts`（配置は既存構造に合わせ調整）に型・定数・enrichment を集約
2. handleStatus 委譲 + allSettled 化
3. 定数参照の集約（4 ファイル）
4. gateway/validators の一本化
5. drift ガードテスト

## 実装メモ（2026-09-11）

- legacy パス定数を `sqliteMessages.ts`（STATUS 契約の共有語彙）に 1 箇所化。sqliteMessageHandlers / opfsMigrationV2Reader / migrationBackup / diagnosticsPanel が import。
- `src/offscreen/sqliteStatus.ts` 新設: `collectMigrationExtras`（allSettled でフィールド隔離 — storage 読み失敗でもフラグ系 extras は生きる）+ プローブ群。`indexedDB.databases` 未実装環境はフィールド省略（旧: silent false → パネルが誤って「対象なし」表示）。 throw 時は null（確認済み不在）。
- **追加で実バグ修正**: offscreenGateway.status() の extras pick が `idbMigrationV2Done` / `opfsLegacyDbPath` / `idbLegacyDbName` を落としており、dashboard 経路で IDB マイグレーション状態が常に欠落していた → 3 フィールドを追加。
- drift ガードテスト（代入パターンの literal が sqliteMessages.ts のみ）+ field-isolation テスト新設。
- スコープ調整: gateway の status/getStatus dual API は役割が異なる薄い委譲（SqliteResult vs plain|null）のため統合せず、実ドリフト（drop フィールド）の修正を優先。
