# バックログ: arch-delivery-loop 0917 — アーキテクチャ診断（2026-09-17 第4回・archloop）

arch-delivery-loop Phase 0 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260917-r17.html`）。直近 15 コミットのホットスポット（queue 失敗伝播・markdown/HTTP SSOT・testConnection テンプレ）+ 未踏領域（entrypoints 配線、dashboard settings クラスタ、messaging validators、SettingsRepository 書き込み経路）を探索し、live 台帳（2026-09-05-00-backlog-future / archloop-0915 / 0915b / arch-review-0917 系）のトリガー発火を全件再確認した。

**サブエージェント起動はモデル unavailable のため、探索は本体セッションで実施**（git show --stat 実測 + 主要ファイル全文読解 + 交差書き込みの契約検証）。

## 台帳トリガー再評価の結果（発火なし・維持）

| 項目 | 状態 |
|---|---|
| QueueFacade 統合（4つ目の consumer） | 未発火。PBI 15/16 + cddef521 で契約が整い、PersistentRetryQueue が shared deep module として成立 |
| i18n フォールバック 301 箇所 | トリガー（次回 popup UI 改修時）未発火で維持 |
| ublock parse 2 関数 | トリガー（次回 ublock 改修時）未発火で維持 |
| RecordSession branch prelude/tail | トリガー（次回 RecordSession 改修時）未発火で維持 |
| statusPanel 分割 | **陳腐化確認** — 実測 429 行（旧台帳の 1456 行記載は過去）。項目は実質解消済み |
| audit orphan cap | **解消確認** — `planAuditLog` seam で `AUDIT_CAP_OPFS` 配線済み（auditHandlers.ts:33） |
| reviewSummary 双子 / SessionStore durability | RICE 低のまま維持（実装に変化なし） |
| MAX_PROVIDERS / utils 物理再配置 | arch-review-0917 台帳の再検討トリガー未発火で維持 |

## RICE スコア表（全3候補・同基準）

採点基準は arch-review-0917 と同一（Reach=今後1年の関与頻度 1-10 / Impact 3-0.5 / Confidence 1.0-0.5 / Effort=ストーリーポイント）。

| スコア順 | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | SettingsRepository 書き込みを delta 契約に（stale snapshot が write lock を無効化） | 7 | 2 | 1.0 | 2 | **7.0** | → PBI 17 |
| 2 | DashboardSqliteValidator の per-subtype schema テーブル化 + archive_query 上限の SSOT 収録 | 3 | 1 | 0.8 | 1 | **2.4** | → PBI 18 |
| 3 | ネイティブ confirm()/alert() 残存 8 箇所 → アクセシブル dialog seam | 3 | 1 | 0.8 | 1 | **2.4** | → PBI 19 |

同点（18 と 19・RICE 2.4）は「リスク軽減 → 緊急性」の順で決定: 18 は上限 drift ガードの同型再発（堅牢性）、19 は a11y 規範の遵守（§4.1）であり、18 を上位。

## 実行順

```
第4ループ（2026-09-17）: 17（settings delta）→ 18（validator schema）→ 19（native dialogs）
依存なし（互いに独立・ファイル非重複）。実装は直列で進める。
```

## 5 Whys サマリー

### PBI 17（settings delta 契約）
1. なぜ設定が巻き戻り得るのか → full スナップショットが `setAll` の delta として渡される
2. なぜ lock が防げないのか → `withLock` の fresh base に stale full blob が spread で勝つ
3. なぜ full blob が渡るのか → `set()` が内部で `getAll()` を展開し、呼び出し側も panel 保持の `currentSettings` をそのまま渡す
4. なぜその interface なのか → merge 機能の便宜で「snapshot-in」が許容されてきた
5. なぜ今直すべきか → dashboard ↔ popup ↔ SW の並行書き手が実在し、CAS/version 機構の効力が interface の形で無効化されている
→ 解: `set()` は delta のみ、`setAll(partial)` は「partial = delta」契約、full-snapshot writer 4 ファイルを移行、交差書き込み回帰テスト新設

### PBI 18（validator schema）
1. なぜ try/catch が 6 重化したか → subtype 追加のたびに block ごと複製された
2. なぜ複製が放置されたか → archive 系の文言差異がテスト pin で守られ、構造の指摘が先行ラウンドの対象外だった
3. なぜ limit 500 が literal のままか → archive_query が limits.ts 整備（0911-08）より後から追加された
→ 解: STAGING_NAME_SUBTYPES セット + field-spec テーブル + MAX_ARCHIVE_QUERY_LIMIT の SSOT 収録

### PBI 19（native dialogs）
1. なぜ confirm/alert が残ったか → archive edit modal の置換ラウンド（09-06）が対象外だった
2. なぜ対象外だったか → panel 機能追加ベースのラウンドで dialog 規範の横断棚卸しが未実施
3. なぜ今か → 8 箇所実測で残存範囲が確定し、既存 seam（focusTrapManager）で移行コストが 1pt に収まる
→ 解: focusTrapManager ベース seam への置換 + utils からの UI 除去

## 健全性確認（本ラウンドの実測）

entrypoints 配線（thin bootstrap 単一経路）・queue クラスタ（PBI 15/16 + cddef521 で契約完了）・opfsWorker auditHandlers（planAuditLog 配線済み）・statusPanel（429 行に縮小済み）は候補なし。
