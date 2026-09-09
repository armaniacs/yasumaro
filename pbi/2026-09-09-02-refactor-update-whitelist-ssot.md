# PBI 02: UPDATE 許可フィールド whitelist 統合 — seam の契約を侵入経路非依存に

## ユーザーストーリー

SQLite 履歴の update を扱う開発者として、フィールドの許可集合が 1 箇所で定義されていてほしい。なぜなら現状は dashboard 経路が 10 フィールド、offscreen 直経路が 31 フィールド（SSOT の手写し）を許し、同じ update 操作の契約が侵入経路で変わるから。フィールド追加時に手写しリストの同期漏れが静かに drift を生む。

## 優先度

- 順位: 02 / 6
- RICE スコア: 19.2（Reach=3 / Impact=2 / Confidence=80% / Effort=0.25 人週）
- 根拠: 台帳 RICE 6.0（2026-09-07 round 2 台帳入り）→ PBI 22 着地でゲート通過、archive 側は既に SSOT import 化済み（`archiveSessionHandlers.ts:157`）と事実確認できたため Confidence 50%→80%、Effort 0.5→0.25 に更新。残る判断は「dashboard の 10 項を意図的狭窄として保持するか」のみで、named subset + subset テストで解決可能。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: 01（limits）完了後に着手（deps.ts / validators.ts を共有）。

## BDD 受け入れシナリオ

```gherkin
Scenario: offscreen 直経路の update が SSOT を参照する
  Given handleUpdate が schema.ts の UPDATABLE_FIELDS を import している
  When  UPDATABLE_FIELDS に新フィールドが追加される
  Then  handleUpdate / crudHandlers / IdbVfsBackend / archiveSessionHandlers が
        追加修正なしで同じ許可集合になる（手写しリストが存在しない）

Scenario: dashboard の狭窄が意図的であることがテストで固定されている
  Given deps.ts の 10 項リストが DASHBOARD_MUTABLE_SUBSET と命名されている
  When  subset 整合テストを実行する
  Then  DASHBOARD_MUTABLE_SUBSET ⊆ UPDATABLE_FIELDS であることが検証され、
        dashboard 経路が 10 項のみ許可する現行契約が文書化される

Scenario: dashboard 経路で許可されないフィールドの現行挙動を維持
  Given dashboard update で gist_synced / content 等の changes を送る
  When  coreCrudHandler が検証する
  Then  Invalid update fields エラーを返す（現行と同一・許可集合の拡大縮小をしない）

Scenario: payload エイリアスが 1 関数に統一される
  Given handleQuery / handleSearch が starred|isStarred / dateFrom|since / tag|tagFilter
        のエイリアスを受ける
  When  正規化関数 normalizeStorageQuery(payload) を通す
  Then  同一の StorageQuery が得られ、handler 每の三項演算子の並びが消える
```

## 受け入れ基準

- [x] `sqliteMessageHandlers.ts:127-159` のインライン 31 項リストを削除し `UPDATABLE_FIELDS` import へ（`crudHandlers.ts:68-80` / `IdbVfsBackend.ts:169-180` と同一パターン）
- [x] `deps.ts:9` の `ALLOWED_UPDATE_FIELDS` を `DASHBOARD_MUTABLE_SUBSET` に rename し、subset 整合テスト新設
- [x] `handleQuery` / `handleSearch` の payload エイリアス（`starred/isStarred`・`dateFrom/since`・`tag/tagFilter`・`gistSynced` coercion 等 7 件）を `normalizeStorageQuery` 純関数 1 個に統合
- [x] `schema.ts:110-116` の陳腐コメント（「OPFS Worker はこのリストを使わない」）を実態に合わせ修正
- [x] gateway フラット化 wire 契約（`offscreenGateway.ts:148` の `{id, ...op.changes}` と handler の `key in payload` 読み）を型 or JSDoc で明示
- [x] `validators.ts` の update / archive_update が shape のみ検証である現状は維持（フィールド名検査は handler 層の責務のまま。変更する場合は実装メモに記録）
- [x] 振る舞い変更なし（dashboard 10 項 / offscreen 31 項の現行契約を保持。統合する場合は意図を記録）

## テスト戦略

- 単体: `normalizeStorageQuery` の真理値表（エイリアス系統ごと・型 coercion 含む）
- 整合: `DASHBOARD_MUTABLE_SUBSET ⊆ UPDATABLE_FIELDS` テスト（新規）
- 回帰: `dashboardSqliteHandlers-extra.test.ts:381-415` / `sqliteMessageHandlers-coverage.test.ts:506+` が green（挙動不変の証明）

## 実装アプローチ

1. `handleUpdate` のインラインリスト削除 → SSOT import（挙動同一を回帰テストで確認）
2. `DASHBOARD_MUTABLE_SUBSET` rename + subset テスト
3. `normalizeStorageQuery` 抽出（handleQuery / handleSearch から呼び出し）
4. 陳腐コメント・wire 契約の文書化

## 見積もり

0.25 人週。難易度: 🟡中。副作用: 🟢なし（挙動不変）。種別: 🔧非機能追加（refactor）。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / 対象テスト green
- [ ] コードレビュー完了
- [ ] 台帳 `2026-09-05-00-backlog-future.md` の「UPDATE 許可フィールドの 4 枚舌リスト」行に完了印
- [ ] `00-INDEX.md` 更新

## 実装メモ（2026-09-09・0909a）

### 同一性確認
- 削除したインライン 31 項リストと `UPDATABLE_FIELDS` は集合・順序ともに完全一致（目視 diff 済み）。`handleUpdate` の `key in payload` 収集ロジック自体は不変のため、offscreen 31 項契約は不変。
- dashboard 側 10 項の値も rename のみで不変。`ALLOWED_UPDATE_FIELDS` の他参照は `coreCrudHandler.ts` のみであることを grep 確認済み。

### `normalizeStorageQuery` の設計判断
- `src/offscreen/queryNormalize.ts` に純関数として新設。`handleQuery` の式を一字一句移管（`pickDefined` による undefined 除外の意味論も同一）し、`handleQuery` は全面委譲、`handleSearch` は `text` 付与＋全面委譲に統一。
- 唯一の意味論差分: 従来 `handleSearch` は limit/offset/orderBy/orderDir のみを読んでいたが、以後は `SQLITE_SEARCH` payload に契約外のフィルタ欄（例: `tagFilter`）が混入した場合に honor される。型上 `SQLITE_SEARCH` payload は 5 欄のみ許可（`sqliteMessages.ts:21`）かつ実 Caller（gateway の search は `SQLITE_QUERY` 経由、`inMemoryTransport` は素通し）は該当欄を送らないため、到達可能な入力での挙動は同一。全 search 系既存テスト（coverage :471-499、`offscreen-search-orderby`）は無修正で green。
- `validators.ts` は shape のみ検証のまま非接触（update の `changes` は object であることのみ検査、フィールド名検査は handler 層に残置）。

### 変更ファイル
- 新規: `src/offscreen/queryNormalize.ts`、`src/offscreen/__tests__/queryNormalize.test.ts`（エイリアス系統ごとの真理値表＋unknown 除外）、`src/background/handlers/dashboardSqlite/__tests__/dashboardMutableSubset.test.ts`（10 項固定＋`⊆ UPDATABLE_FIELDS`）
- 編集: `src/offscreen/sqliteMessageHandlers.ts`（`handleUpdate` の SSOT 化、`handleQuery`/`handleSearch` の委譲化）、`src/background/handlers/dashboardSqlite/deps.ts`（rename＋WHY コメント）、`src/background/handlers/dashboardSqlite/coreCrudHandler.ts`（参照更新）、`src/offscreen/schema.ts`（陳腐コメントのみ修正）、`src/background/sqlite/offscreenGateway.ts`（update フラット化の wire 契約を JSDoc 化）

### 検証結果
- `npm run type-check`: clean
- `npx vitest run src/messaging src/background/handlers/dashboardSqlite src/offscreen/__tests__/sqliteMessageHandlers-coverage.test.ts src/offscreen/__tests__/queryNormalize.test.ts src/background/__tests__/dashboardSqliteHandlers-append.test.ts src/offscreen/__tests__/offscreen-search-orderby.test.ts src/offscreen/__tests__/schema-comprehensive.test.ts`: 20 files / 421 tests green
- 広域回帰（`src/background src/offscreen src/messaging src/dashboard`）: 5969 pass / 1 fail。fail は `query-backends-parametric.test.ts` の 1 件で、原因は並行エージェント作業中の `IdbVfsBackend.ts`/`queryPlan.ts`/`opfsWorker/*` の refactor（当該テストが import するモジュールはいずれも本 PBI 非接触。`schema.ts` 差分はコメントのみ）。自分のスコープ外のため非接触とし、ここに記録する。
- `npm run lint`: 自分のファイルは 0 errors（repo 全体では並行作業中の `aiSummaryCleaner/rules.ts` に 2 errors、対象外）
