# PBI: sqlite purge/query/id 双子の集約（refactor）

優先度: 台帳 RICE 4.0（Reach 4 / Impact 1 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C2）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、SQLite ハンドラの purge・query・id 系双子を集約してほしい、なぜなら現在は破壊操作の fail-closed 順序ごと複製されており、順序変更時の片側漏れがデータ破壊または沈黙の no-op を生むから。

## 背景（現状と課題）

`src/offscreen/sqliteMessageHandlers.ts` に以下の双子がある（着手時に行番号を再確認すること）：

1. `handlePurge`（174-185行目付近）と `handleContentPurge`（187-196行目付近） — `planPurge` の fail-closed + purge 実行が複製され、`includeStarred` 引数の有無のみが差異
2. `handleDelete`（118-122行目付近）と `handleToggleStar`（124-128行目付近） — `Number(payload.id)` + 単一 repo 呼び出しの形が複製
3. `handleQuery`（72-76行目付近）と `handleSearch`（99-103行目付近） — plan して `sqliteQuery` に渡す形が複製

対応方針: `runPlannedPurge(payload, includeStarred?)`・`runById(payload, fn)`・`runPlannedQuery(payload, planner)` の helper に集約する。応答 shape・error 文言・fail-closed 順序は不変。archive dispatch テーブルには触れない。

## BDD受け入れシナリオ

```gherkin
Scenario: 不正な purge 数値が両操作で同一に fail-closed する
  Given garbage な retentionDays/maxRecords を持つ SQLITE_PURGE / CONTENT_PURGE
  When 各ハンドラを呼ぶ
  Then 両方とも統合前と同一の失敗応答を返し、purge 本体は実行されない

Scenario: delete/toggleStar が同一 shape を返す
  Given 正常な id を持つ SQLITE_DELETE / SQLITE_TOGGLE_STAR
  When 各ハンドラを呼ぶ
  Then 応答 shape は統合前と同一である
```

## 受け入れ基準

- [x] 3 helper が定義され、6 ハンドラが委譲している
- [x] 全応答 shape・error 文言が統合前と byte-identical
- [x] fail-closed 順序（plan → guard → 実行）が単一箇所にある
- [x] レジストリの網羅性（`satisfies Record<SqliteMessageType, ...>`）が維持される
- [x] `npm run type-check` が green
- [x] sqliteMessageHandlers 関連 vitest が green

## テスト戦略

- parity テスト（新規）: purge 失敗枝・正常枝の応答を pin してから集約する
- 既存テストの維持: `sqliteMessageHandlers-coverage.test.ts` 等が無修正でパスすること

## 見積もり

1pt（3 helper + 6委譲 + parity test）。

## 実装ガイド

- 着手時点での確認ポイント: `src/offscreen/sqliteMessageHandlers.ts:58-200`、`planPurge`（queryPlanner 側）の契約
- archive 系（handleArchive 派生）には触れないこと
- フルテストスイートは統合側が行う。担当検証は type-check + 関連 vitest に絞る
