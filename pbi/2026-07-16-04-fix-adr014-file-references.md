# PBI: ADR-014 ファイル参照の現状化

## ユーザーストーリー

開発者として、ADR-014（OPFS/FTS5 共存）の「主な変更ファイル」記述を現在の実装に合わせて更新したい、なぜなら記述が古いままだと設計意図から実装コードへたどり着けず、新規開発者のオンボーディングが低下するから。

出典: `docs/blog-6_5/offscreen-opfs-sqlite-coexistence-deep-dive.md`「開発者の方向け: すぐに効く改善案」より、4項目のうち文書更新のみの1件を切り出したもの。
関連ADR: `dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`（ADR-014）。

本PBIは元 `pbi/2026-07-16-03-fix-offscreen-opfs-sqlite-coexistence.md`（brainstormingで深掘り後に3+1分割）の一部。関連: [[2026-07-16-05-fix-sqlite-message-type-unification]] [[2026-07-16-06-fix-idb-fallback-subframe7536-migration]]

## ビジネス価値

- ADR-014 の記述と実装コードの乖離を解消し、新規開発者が設計意図から実装へたどり着けるようにする（オンボーディング・トレーサビリティ向上）
- ドキュメントのみの変更のため、最小工数でリスクなく着手できる

## 既実装確認（フェーズ0で実施済み）

```bash
# sqlite.ts は re_exports に退化している
grep -n "export\|re_export" src/offscreen/sqlite.ts | head
# → sqlite.ts の実体は engine / recordsRepo / dbMaintenance / auditLogRepo の re_exports のみ
# → 責務は sqliteEngineContext.ts / recordsRepo.ts / dbMaintenance.ts / auditLogRepo.ts の4モジュールへ移動済み

# sqliteEngine.ts は @subframe7536 の薄いラッパで、sqliteEngineContext.ts とは別責務
grep -n "import.*subframe7536" src/offscreen/sqliteEngine.ts
# → L1 initSQLite, L2 useOpfsStorage をimport（@subframe7536/sqlite-wasm の薄いラッパ）
```

- ADR-014 の「主な変更ファイル」表は `sqlite.ts` を実体のあるファイルとして記載したままで、上記の分割を反映していない → **未反映（本PBIで対応する作業）**
- `sqliteEngine.ts`（`@subframe7536/sqlite-wasm` ラッパ）と `sqliteEngineContext.ts`（状態管理: OPFS Worker state, IDB/wa-sqlite初期化, フォールバック等）という2ファイルの責務分担も ADR に記載がない → **未反映**

## BDD受け入れシナリオ

```gherkin
Feature: ADR-014 ファイル参照の現状化

  Scenario: ADR-014 が sqlite.ts の re_exports 退化を説明している
    Given dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md が存在する
    When  ADR の「主な変更ファイル」セクションを確認する
    Then  sqlite.ts が re_exports に退化し、実体が
          sqliteEngineContext.ts / recordsRepo.ts / dbMaintenance.ts / auditLogRepo.ts に
          分割されたことが記載されている
    And   sqliteEngine.ts（@subframe7536 ラッパ）と sqliteEngineContext.ts（状態管理）の
          責務分担が記載されている

  Scenario: 存在しないファイルパスへの参照がない
    Given ADR-014 の「主な変更ファイル」表を確認する
    When  表内の各ファイルパスに対して存在確認を行う
    Then  すべてのパスが src/ 配下に実在する
```

## 受け入れ基準
- [ ] ADR-014 の「主な変更ファイル」表が `sqlite.ts` の re_exports 化を反映している
- [ ] `sqliteEngine.ts` と `sqliteEngineContext.ts` の責務分担が1文以上で説明されている
- [ ] 表中の全ファイルパスが実在する（リンク切れなし）

## テスト戦略（t_wadaスタイル）

本PBIはドキュメントのみの変更のため自動テストは対象外。受け入れ基準のチェックリストによる目視レビューで完了とする。

## 実装アプローチ

- ドキュメント編集のみ。コード変更は発生しない
- 編集後、Markdownリンク切れがないか `grep` で対象パスの実在を確認する

## 見積もり

1pt（ドキュメントのみ、最小工数）

## 技術的考慮事項
- 依存関係: なし。他の2PBI（メッセージ型統一・IDB移行）とは独立して着手可能
- テスタビリティ: 対象外（文書変更）
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "export\|re_export" src/offscreen/sqlite.ts | head
grep -n "import.*subframe7536" src/offscreen/sqliteEngine.ts
ls src/offscreen/recordsRepo.ts src/offscreen/dbMaintenance.ts src/offscreen/auditLogRepo.ts src/offscreen/sqliteEngineContext.ts
```

### 実装手順
1. `dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md` の「主な変更ファイル」表を開く
2. `sqlite.ts` の行を re_exports 専用ファイルである旨に更新し、実体である4モジュールを追記
3. `sqliteEngine.ts` と `sqliteEngineContext.ts` の責務分担を1〜2文で追記

### 落とし穴
- ADR本文の他の記述（3段フォールバックの説明など）は現状も正しいため、不要な書き換えをしないこと。変更は「主な変更ファイル」表とその周辺の責務分担説明に限定する

## Definition of Done
- [ ] ADR-014 の記述が現在の実装と一致している
- [ ] レビュー完了
