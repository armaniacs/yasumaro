# PBI: アーカイブE2E用の共通 fixture 化（deferred マイグレーション待ちと seed ヘルパ）

## ユーザーストーリー

yasumaroの開発者として、アーカイブ系 E2E の setup 手順が spec 間で共通化されてほしい。なぜなら、2026-09-07-02 の G4 で発見した「最初の DASHBOARD_SQLITE 呼び出しで deferred レガシーマイグレーションが走る」挙動への対処が G4 のテスト内にインライン実装されたままで、今後レガシーストアを触るテストが増えるたびに同じ落とし穴を踏むから。

## 背景

2026-09-07-02（G4）で判明したE2E setup の隠れた制約:

1. **deferred マイグレーション**: `service-worker.ts` の `runDeferredStartupMigrations` は「最初のメッセージハンドラ起動の直前」に1回だけ走る。テストが先に `savedUrlsWithTimestamps` を seed すると、マイグレーションがそれを SQLite に移して seed 件数が倍になる。対処は「warm-up メッセージ（get_count）→ `legacyStoreReadOnly` フラグ待ち → `yasumaro_migration_status: 'completed'` 封印 → seed」の4手順で、G4 のテスト内に直接書かれている（`archive-recommended-verification.spec.ts` G4）
2. **seed の重複挙動**: `poll` で import を再送する既存パターンは UNIQUE 制約で冪等だが、これは仕様の暗黙知。共通化時に明文化する
3. **opts ページのオープン + クライアント生成**: 3 spec で同じ 4 行が繰り返されている（`openOptionsPage` が spec ごとに private 定義）

本PBIはテスト資産の重複を統合する refactor であり、挙動変更・新規検証は発生しない。

## ユーザーストーリー（テスト資産）

yasumaroの開発者として、レガシーストア絡みの E2E を書くときに「マイグレーション完了待ち」を1行で宣言できてほしい。なぜなら、手順を忘れると seed 件数が非決定的になり、実エンジン挙動の変化とテストの偶然を区別できなくなるから。

## BDD受け入れシナリオ

```gherkin
Scenario: 共通 fixture でマイグレーション完了を待てる
  Given dashboardSqliteHelpers に migrationSettled を提供する関数が存在する
  When G4 テストがそれを呼ぶ
  Then 最初の DASHBOARD_SQLITE メッセージで deferred マイグレーションが走り
  And legacyStoreReadOnly フラグのセットを待ってから制御が戻る

Scenario: 既存 spec は共通化しても同じ結果になる
  Given 3 spec が openOptionsPage / seedRows を共通 fixture から import する
  When 全 @extension E2E を実行する
  Then 全テストがグリーン（テスト件数・アサーション不変）
```

## 受け入れ基準

- [x] `testDir/e2e/fixtures/dashboardSqliteHelpers.ts` に `openOptionsPage`（既存3 spec の重複を統合）と `migrationSettled`（warm-up → `legacyStoreReadOnly` 待ち → `yasumaro_migration_status` 封印）を追加
- [x] 既存 3 spec（`archive-required-verification` / `archive-recommended-verification` / `dashboard-archive`）が共通 fixture を import する形にリファクタ（グリーン後のリファクタリング段階として、テスト件数・アサーションは不変）
- [x] `seedRows` の冪等性（UNIQUE 制約で再送安全）を JSDoc で明文化（seedRows も共通化 — 2 spec の同一実装を統合し JSDoc を付与）
- [x] テスト専用 subtype / フラグは追加しない
- [x] `npm run validate` + 全 `@extension` E2E がグリーン（テストの実行順序依存が無いことを `-g` での個別実行でも確認）

## 完了メモ（2026-09-07）

### 産出物（dashboardSqliteHelpers.ts に統合）
- `openOptionsPage(context, extensionId)`: options.html オープン + runtime bridge 待ち（3 spec の重複を統合）
- `migrationSettled(page, client)`: get_count で deferred runner を起動 → `legacyStoreReadOnly` フラグ待ち（expect.toPass）→ `yasumaro_migration_status: 'completed'` で封印。G4 のインライン 4 手順を置換
- `seedRows`: 2 spec の同一実装を統合 + 冪等性 JSDoc（`created_at` 固定値規約）
- `runPhaseA` / `isoDateOffset`: 2 spec の同一実装を統合（05 でも再利用）

### リファクタ内容
- 3 spec の private `openOptionsPage` を削除（dashboard-archive は inline 2 箇所）
- G4 のインライン手順 → `migrationSettled` 1 行
- R1〜R3 の seed を `seedRows` へ（アサーション同値・失敗メッセージ改善のみ）
- 推奨側の `DashboardSqliteClient.scopeHash` の parts 型に `boolean` を追加（`includeDeleted` を scope に含めるため — 実態は String() 結合で挙動不変）

### 検証
- 全 `@extension` E2E: 34 passed / 1 skipped
- `-g` 個別実行（R1/R3/G4/G5 と R2 群）で順序非依存を確認
- ベースラインゲートが helper への新規型エラー（scopeHash parts 型に boolean 足りない等 4 件）を即検出 — PBI-04 のゲートが機能している実証。修正して exit 0 維持

## テスト戦略

### E2Eテスト
- リファクタのみ（新規検証なし）。全既存 E2E が無修正の期待値でパスすることで安全を担保

### 単体テスト
- なし

## 実装アプローチ

1. `dashboardSqliteHelpers.ts` に `openOptionsPage` を移設（`extensionId` 受け取り → goto → waitForFunction → page 返却）
2. `migrationSettled(page)` を追加: `get_count` 送信 → `legacyStoreReadOnly` を `expect.toPass` で待つ → `yasumaro_migration_status: 'completed'` をセット
3. 3 spec の private `openOptionsPage` / G4 のインライン手順を置換
4. 全 E2E 実行でリグレッション確認

## 見積もり

1pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-05 と独立（並行可）。ただし 05 も同じ fixture を使うため、05 の前に本PBIを先に済ませると手戻りがない
- **テスタビリティ**: fixture の挙動は既存 E2E のグリーンで担保
- **非機能要件**: なし（テスト資産のみ）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "openOptionsPage" testDir/e2e/*.spec.ts | head -6
grep -n "legacyStoreReadOnly\|yasumaro_migration_status" testDir/e2e/archive-recommended-verification.spec.ts
grep -n "poll" testDir/e2e/fixtures/dashboardSqliteHelpers.ts | head -3
```

### 落とし穴
- **migrationSettled のタイミング**: warm-up メッセージは「どの spec より先」に送る必要がある。テストごとに fresh profile のため、fixture 呼び出し順で自然に解決する
- **poll の再送による二重 insert**: UNIQUE(url, created_at) で冪等だが、created_at を実行時刻依存にすると再送で別行になる。seed の created_at は固定値（Date.UTC）を使う規約を JSDoc に書く
- **fixture の import 順序**: playwright の TS 解決は `.js` 拡張子 import。既存 fixture と同じ書き方を守る

## Definition of Done

- [x] 共通 fixture が実装され 3 spec が統合済み
- [x] 全 `@extension` E2E グリーン（期待値不変）
- [x] `npm run validate` が通る
- [x] コードレビュー完了
