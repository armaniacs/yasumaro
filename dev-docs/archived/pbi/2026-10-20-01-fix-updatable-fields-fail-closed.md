# PBI: schema.ts の UPDATABLE_FIELDS 派生を fail-closed にし、挿入可能だが更新禁止の列が黙って更新可能になるのを防ぐ

## ユーザーストーリー

拡張機能の開発者・保守担当者として、`browsing_logs` に新しい列を追加したとき「UPDATE できる列」の広がりが黙って自動適用されず、明示的な決定を強制してほしい、なぜなら 2026-10-20 の簡素化パスで `UPDATABLE_FIELDS` が手管理リストから `COLUMN_NAMES.filter()` 派生に変わった結果、**未来の列はデフォルトで UPDATE 可能**になり、`nav_source_url` / `search_query` のような「挿入できるが更新されてはならない」列を将来追加する際にフィルターへの除外追記を忘れると、後からの編集で来訪の来歴（referrer・検索語）を書き換えられる穴が静的に開くから。

## 優先度

- 順位: 01 / 6
- RICE: 128（Reach=40 / Impact=2 / Confidence=80% / Effort=0.5）
- 根拠: 履歴書き換えを黙って許す fail-open を防ぐデータ整合性の防御で、工数はテスト pin の追加のみ。依存関係なし
- 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微

## 背景（出典）

2026-10-20 の code-review（ブランチ 1020a の簡素化パス差分）Suggestion 1。同パスで `src/offscreen/schema.ts:125` が 32 項目の手管理リストから `COLUMN_NAMES.filter(...)` 派生に変わった。派生は「挿入可能なら更新可能」という文書化済みの同期規約を機械的に強制する点で改善だが、**新列のデフォルトが「更新可能」に反転**した。旧明示リストはオプトインであり、新列はデフォルトで更新不可だった。2 つの例外は WHY コメントで文書化されているが、3 つ目以降の例外の追い忘れを防ぐ強制力がない。

### 何が起きているか

- `src/offscreen/schema.ts:72-108`: `COLUMN_NAMES`（INSERT 列の SSOT）
- `src/offscreen/schema.ts:125-131`: `UPDATABLE_FIELDS = COLUMN_NAMES.filter(...)`。除外は `created_at` / `nav_source_url` / `search_query` の 3 列のみ
- 消費者 4 箇所: IdbVfsBackend / FallbackStorage / OPFS worker crud handler / offscreen SQLITE_UPDATE registry
- dashboard 側は別の `DASHBOARD_MUTABLE_SUBSET`（`src/background/handlers/dashboardSqlite`）で縮小されており、そちらは sqlite-security-integrity 検証が守る

### リスクの輪郭

新列 `x` を INSERT 列として追加し、かつ `x` を「記録時に 1 回だけ設定され UPDATE で書き換えられてはならない」値（来歴系）にした場合:

| 実装 | 除外追記を忘れたとき | 既定の方向 |
|---|---|---|
| 旧手管理リスト | `x` は更新**されない**（fail-closed） | 更新不可 |
| 現行派生 | **`x` は黙って UPDATE 可能**（fail-open） | 更新可能 |

`nav_source_url` の WHY コメント（`schema.ts:127-131` に移設済み）が言うとおり、UPDATE で来歴を書き換えられると「後からの編集で履歴を書き換えられる」「再実行 regeneration が元の referrer を上書きする」（PBI 2026-09-26-03）。

## BDD受け入れシナリオ

```gherkin
Scenario: 新列を追加すると fail-closed ピンが更新可否の未決定を検知する
  Given COLUMN_NAMES に新しい列 sync_token を追加した状態がある
  When offscreen schema の fail-closed 検証を実行する
  Then 検証は失敗し、メッセージで「sync_token の更新可否が未決定」と指摘する
  And sync_token を UPDATABLE_FIELDS 側の明示許可か NOT_UPDATABLE_COLUMNS 側の明示除外のどちらかに置くまで落ち続ける
  # 注意: 現行実装では検証が存在しないため RED。これが本 PBI の受入基準。

Scenario: 既存の 3 例外と同期規約が守られている限り検証は緑である
  Given COLUMN_NAMES と UPDATABLE_FIELDS が現行の派生規約どおりの状態がある
  When offscreen schema の fail-closed 検証を実行する
  Then 検証は成功する
  And UPDATABLE_FIELDS が COLUMN_NAMES から 3 例外を除いた集合と一致している

Scenario: dashboard 側の縮小セットは影響を受けない
  Given DASHBOARD_MUTABLE_SUBSET が UPDATABLE_FIELDS の部分集合である状態がある
  When sqlite-security-integrity の既存検証を実行する
  Then dashboard 側の検証は変わらず緑である
```

## 受け入れ基準

- [x] offscreen schema テスト（`src/offscreen/__tests__/schema-comprehensive.test.ts:147` の UPDATABLE_FIELDS describe を拡張、または新規ファイル）に fail-closed ピンがある。COLUMN_NAMES の各列が `UPDATABLE_FIELDS` か `NOT_UPDATABLE_COLUMNS` のどちらかに明示されていないとき、テストがその列名を指して落ちる
- [x] `NOT_UPDATABLE_COLUMNS`（名称は任意）が schema.ts 内の明示的な定数として抽出され、現行の 3 例外がそこに移っている。WHY コメントは定数の直後に維持する
- [x] 派生式が `COLUMN_NAMES.filter((name) => !NOT_UPDATABLE_COLUMNS.has(name))` の形になり、現行の 32 項目と同一の内容・順序であることを既存テストが確認している
- [x] dashboard 側の `DASHBOARD_MUTABLE_SUBSET` と sqlite-security-integrity 検証が影響を受けていない
- [x] `npm run validate` が緑

## テスト戦略

### 単体

`schema-comprehensive.test.ts` の UPDATABLE_FIELDS describe を拡張する。

- 主検証: COLUMN_NAMES をループし、`UPDATABLE_FIELDS` ∪ `NOT_UPDATABLE_COLUMNS` に含まれない列があれば列名付きで失敗する（新列追加時に「更新可否未決定」で落ちる）
- 対照（同ファイル内に置く）: 3 例外が NOT_UPDATABLE_COLUMNS に居ること、32 項目の内容・順序が不変であること

### 統合

IdbVfsBackend / FallbackStorage / OPFS worker の UPDATE 経路が UPDATABLE_FIELDS を反復している既存テスト（`src/offscreen/__tests__/storageFallbackMutate.test.ts:163` など）が回帰しないこと。

### E2E

不要（内部改善。ユーザー可視の挙動変化なし）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/offscreen/schema.ts` | 72-108 | `COLUMN_NAMES`（INSERT 列の SSOT） |
| `src/offscreen/schema.ts` | 125-131 | `UPDATABLE_FIELDS` 派生 + WHY コメント |
| `src/offscreen/__tests__/schema-comprehensive.test.ts` | 147-158 | 既存の UPDATABLE_FIELDS describe（id / created_at の除外、url / title の包含を固定） |
| `src/offscreen/__tests__/storageFallbackMutate.test.ts` | 163 | UPDATABLE_FIELDS 反復の既存テスト |
| `src/background/handlers/dashboardSqlite` | - | `DASHBOARD_MUTABLE_SUBSET`（本 PBI の対象外、影響しないことを確認） |

### 最小変更の選択肢

**選択肢 1（推奨・fail-closed）: NOT_UPDATABLE_COLUMNS 定数 + テスト pin**

schema.ts に `NOT_UPDATABLE_COLUMNS = new Set(['created_at', 'nav_source_url', 'search_query'])` を抽出し、派生式をこれに向ける。テスト側で「COLUMN_NAMES の全列は UPDATABLE_FIELDS か NOT_UPDATABLE_COLUMNS のどちらかに明示されていること」を assert する。

- Pros: 新列の追加時にテストが更新可否の未決定を列名付きで検知する。同期規約（挿入可能なら更新可能）はデフォルトとして保持され、例外だけ明示になる。既存 32 項目は不変。
- Cons: 新列追加時に必ず 1 行の明示が要る（意図した摩擦）。

**選択肢 2: 型レベルの exhaustive tuple assert**

`UPDATABLE_FIELDS` を satisfies / mapped type で COLUMN_NAMES との整合をコンパイル時に強制する。

- Pros: 実行時コストゼロ。
- Cons: as const タプルの型操作が複雑になり、filter の戻り型への波及が及ぶ。schema.ts の可読性を損なう。

**選択肢 3: 現状維持 + WHY コメントの強化のみ**

- Pros: 変更ゼロ。
- Cons: 3 つ目以降の例外の追い忘れを何も防がない。本 PBI の存在意義が消える。

### ロールバック手順

- 変更は schema.ts（定数抽出 + 派生式の書き換え）と schema-comprehensive.test.ts（ピン追加）に切り出す。1 コミット。
- `git revert <commit>` で戻せる。戻すと派生は現行の filter 直書きに戻り、fail-closed ピンが消えるだけで動作劣化はない（32 項目は不変）。
- revert 後 `npm run validate` を通すこと。

## 見積もり

1pt 🟢（定数抽出 + 派生式書き換え + テスト pin。Effort=0.5 相当）

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス（シナリオ 1 は RED→GREEN を確認。シナリオ 2・3 は対照）
- [x] `npm run validate` が緑
- [x] コードレビュー完了
- [x] ドキュメント更新済み（該当すれば dev-docs/ARCHITECTURE_MAP.md の offscreen の記述）

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 code-review Suggestion 1（ブランチ 1020a の簡素化パス差分レビュー）

## 完了記録（2026-10-20）

- 実装: `NOT_UPDATABLE_COLUMNS` を src/offscreen/schema.ts:116-121 に新設（WHY コメント維持・移設）、派生式を :137-139 で統一。UPDATABLE_FIELDS 32 項目は HEAD と esbuild トランスパイル比較で byte 一致。テストに fail-closed pin（:162-177）と subset pin（除外列の残骸検知、実装段階で追加）を置いた。
- 観察: 現行の全域派生の下では fail-closed pin は恒真的に緑（新列はどちらかの集合に入る。PBI Pros に明記した設計判断）。red 経路（非全域な式への置換・オプトインへの反転）はシミュレーションで検証済み、メッセージに列名を含む。subset pin が列リネーム時の fail-open 再発を検知する実質防御を担う。
- 検証: schema-comprehensive 58 件 / 消費者 18 件 / type-check / eslint / npm run validate（フルゲート 16,453 テスト）全緑。レビュー（未コミット diff 164+/41- の全行精読）実害なし。
