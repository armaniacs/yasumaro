# PBI 03: STATUS extras を単一 field list に統一し OffscreenResponse union を完成させる

## ユーザーストーリー

診断パネルを保守する開発者として、STATUS にフィールドを追加するとき 1 箇所だけ直せば型検査が他 hop を強制してほしい。なぜなら現状 4 箇所の手書きリストが相互に型結合しておらず、round 4 で gateway 側を直しても次の追加で同じ silent drop が再発するから。

## 優先度

- 順位: 03 / 10
- RICE スコア: 16.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.3 人週）
- 根拠: producer `sqliteStatus.ts:67-107`（8 フィールド）／gateway pick `offscreenGateway.ts:215-223`（12 フィールド）／validator `sqliteValidators.ts:101-112`（独立 9 フィールド）／dashboard 戻り値 `dashboardSqliteService.ts:216-257`（リテラル再宣言）。`StorageBackend.StatusResult:54-63` に extras フィールドが無いため handler の spread が型検査外。deletion test 正: `decodeStatusExtras` を消しても型は通る（実行時だけ壊れる）。加えて `OffscreenResponse` union（`sqliteMessages.ts:307-326`）が送信可能な 6 変数（ArchiveOpen/Query/Update/Save/Close/Status）を欠く。

## BDD 受け入れシナリオ

```gherkin
Scenario: extras フィールド追加が 1 箇所で完結する
  Given SqliteMigrationExtras に新フィールドを追加する
  When 型検査を実行する
  Then StatusResult / decodeStatusExtras / dashboard 戻り値型は派生で追従し、
       gateway pick は extras 型との差分でコンパイルエラーになる

Scenario: union が全送信可能応答を網羅する
  Given sqliteMessageHandlers が送り得る全 Offscreen*Response 型
  When OffscreenResponse union を確認する
  Then archive session の 6 変数を含む（欠落による網羅 switch の黙って排除が無い）
```

## 受け入れ基準

- [x] `SqliteMigrationExtras` を唯一の field list とする（`StorageBackend.StatusResult` が extras を含むか、handler の merge が型検査下に入る）
- [x] `decodeStatusExtras` と `dashboardSqliteService.getSqliteStatus` 戻り値型を派生に置換（手書きリスト削除）
- [x] `OffscreenResponse` union に 6 archive session 変数を追加（分割 sqliteResponses.ts は台帳送り）
- [x] offscreen / messaging / dashboard の STATUS 関連テスト green

## テスト戦略

既存 STATUS テスト green + 型レベルの派生確認（type-check）。union 完全性は既存の bidirectional assert パターンに倣う。

## 見積もり

M（0.3 人週）。種別: refactor（+ union 完成は fix）。

## 実装アプローチ

1. `StatusResult` を extras 含む形に拡張 → handler spread を型検査下に
2. `decodeStatusExtras` を `SqliteMigrationExtras` 由来に、dashboard 戻り値型を `OffscreenStatusData` 由来に
3. union 6 変数追加 + コンパイル時完全性 assert

## 実装メモ（2026-09-11 round 5）

- `SqliteStatusExtras`（11 フィールド）を `sqliteMessages.ts` に定義し、全 hop を派生に統一:
  - `StorageBackend.StatusResult` が extras を継承（handler の spread が型検査下に）
  - `sqliteValidators.decodeStatusExtras` を mapped decoder テーブル化（フィールド追加はコンパイルエラーで漏れ検出）+ `pickStatusExtras` 新設
  - `offscreenGateway.status()` の pick を `pickStatusExtras(r)` に置換（round 4 の手書き 11 フィールドを撤去）
  - `dashboardSqliteService.getSqliteStatus` 戻り値型を `SqliteStatusResult`（fts5 は dashboard hop で requiredBoolean 保证のため再 narrow）に
  - `sqliteStatus.ts` の `SqliteMigrationExtras` を `Pick<SqliteStatusExtras, ...>` に
- `OffscreenResponse` union に欠落していた 6 変数（ArchiveOpen/Query/Update/Save/Close/Status）を追加。
