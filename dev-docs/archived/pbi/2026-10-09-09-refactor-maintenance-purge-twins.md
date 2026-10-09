# maintenanceBatchHandler の purge_now / content_purge_now ツイン統合（refactor）

## 1. タイトル + 種別

- **タイトル**: `maintenanceBatchHandler` の `purge_now` / `content_purge_now` ツイン統合 — 複製された 17 行のパージフローを共通 runner に集約する
- **種別**: refactor（挙動不変・重複排除のみ）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 9
- **RICE**: R3 / I1 / C1.0 / E1 → **3.0**
- **根拠**:
  - 「settings 読み → 両方 null なら `skipped:true` → deps.purge* → toFailure → `{ success: true, purged, skipped: false }`」の 17 行フローが 2 ケースに複製されている。差分はストレージキーと deps 呼び出しの引数のみ
  - 重複した分岐フローは、応答 shape やガード条件の片側だけの修正ミス（drift）を生む。共通 runner に集約すれば修正点が 1 か所になる
- **依存**: なし

## 3. ユーザーストーリー

**maintenanceBatchHandler の保守担当者として**、`purge_now` と `content_purge_now` のパージフローが 1 本の共通 runner に集約されていてほしい。なぜなら、同一フローが 2 ケースに複製されていると、ガード条件や応答 shape の修正が片側にしか反映されず、ツイン間の挙動差（drift）が黙って混入するから。

## 4. 背景

`maintenanceBatchHandler` の 2 ケースは、同一の 17 行フローを複製している:

1. `deps.getSettings()` で settings を読む
2. 保持設定（days / max）が**両方 null** なら `{ success: true, purged: 0, skipped: true }` を返す
3. `deps.purge*` を呼ぶ
4. 失敗なら `toFailure(result)` で変換
5. 成功なら `{ success: true, purged, skipped: false }` を返す

両者の差分はストレージキーと deps 呼び出しの引数のみ。

該当箇所（全 file:line 検証済み）:

- `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:72-87` — `purge_now` ケース。`SQLITE_RETENTION_DAYS` / `SQLITE_MAX_RECORDS` を読み、`deps.purgeOldRecords(days, max)` を呼ぶ
- `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:88-105` — `content_purge_now` ケース。`CONTENT_RETENTION_DAYS` / `CONTENT_MAX_RECORDS` を読み、`deps.purgeContent(days, max, includeStarred)` を呼ぶ

改善案: `runSettingsPurge(readKeys, purge)` を 1 本置く。null → skipped ガードは runner に移る。既存の `toFailure` 変換と応答 shape は現行どおり保持。挙動不変。

## 5. BDD シナリオ

### シナリオ 1: 両方の保持設定が null の場合、deps を呼ばず skipped 応答を返す

```gherkin
Given 共通 runner が readKeys で指定された 2 つの保持設定を読む
And 保持設定が両方 null である
When purge ケース（purge_now / content_purge_now）を実行する
Then deps.purge* が呼び出されないこと
And { success: true, purged: 0, skipped: true } を返すこと
```

### シナリオ 2: 保持設定がある場合、引数付きで deps を呼び purged 付き応答を返す

```gherkin
Given 保持設定の少なくとも一方が null でない
When purge ケース（purge_now / content_purge_now）を実行する
Then deps.purge* が現行どおりの引数構成で呼び出されること
  And purge_old の場合は days / max を渡すこと
  And content の場合は days / max / includeStarred を渡すこと
And deps が成功した場合 { success: true, purged, skipped: false } を返すこと
```

### シナリオ 3: deps が失敗した場合、toFailure 変換が維持される

```gherkin
Given 保持設定が両方 null でない
When deps.purge* が失敗結果を返す
Then toFailure(result) による変換が現行どおり行われること
```

## 6. 受け入れ基準

- [x] `runSettingsPurge(readKeys, purge)` の共通 runner が 1 本追加されている
- [x] `purge_now` / `content_purge_now` の両ケースが runner 経由に統合され、17 行の重複フローが解消されている
- [x] null → skipped ガード（両方 null なら `{ success: true, purged: 0, skipped: true }`）が runner 内に移動している
- [x] deps 呼び出しの引数構成（`purgeOldRecords`: days / max、`purgeContent`: days / max / includeStarred）が現行どおり維持されている
- [x] `toFailure` 変換と応答 shape（`{ success, purged, skipped }`）が現行どおり維持されている
- [x] 挙動が完全に不変である（既存ハンドラ parity テスト全通過、ロジック変更なし）

## 7. テスト戦略

1. **parity pin 先行**: 着手前に既存ハンドラ parity テストの pin（応答 shape、skipped 応答、deps 呼び出し引数、`toFailure` 変換）を確認し、リファクタリング中の安全網として使う
2. **既存ハンドラ parity テストの green 維持**: pin は無変更で維持する。両ケースの統合により pin が一切失敗しないことを確認する
3. **BDD シナリオの担保**: skipped / purged / failure の 3 経路が既存 parity テストで担保されていることを確認し、不足があれば同一ハンドラ系テストに追加する
4. **挙動不変の確認**: `npm run validate`（type-check + test）で既存テスト全通過を確認する

## 8. 見積もり

**1 SP** — 1 ハンドラファイル内の重複排除のみ。共通 runner の抽出、ガード移動、2 ケースの差分（ストレージキーと deps 引数）を引数化するだけでロジック変更なし。影響範囲は `maintenanceBatchHandler.ts` 1 ファイル

## 9. DoD

- [x] 受け入れ基準 6 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] 既存ハンドラ parity テストが pin 無変更（応答 shape・`toFailure` 変換・deps 引数）で通過
- [x] `maintenanceBatchHandler` 内にパージフローの複製が残っていない（両ケースが共通 runner 経由）
- [x] 挙動不変（deps 呼び出し回数・引数・応答に変化なし）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 9（R3 / I1 / C1.0 / E1 → 3.0）
- 依存: なし
