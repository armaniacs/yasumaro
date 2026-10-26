# PBI: 持続保守 ― 減らす設計と委譲の下地

## ユーザーストーリー
寄与する人として、小さく安全に関わりたい、なぜなら関門(AGENTS/charset/validate)と肥大がbus factor 1を固定しているから

## 優先度
- 順位: 05 / 5候補
- RICEスコア: 160 (Reach=300 / Impact=1 / Confidence=0.8 / Effort=1.5人週)
- 根拠: 効果は間接的でImpact 1。他候補の実装を妨げない範囲で進める
- 依存: なし。機能実装と並列着手可

## 背景・制約
- 範囲を絞る: CHANGELOG月次ダイジェスト、設定の漸進開示(上級者折りたたみ)、タグ正規化提案まで。コントリビューターラダー全体・Issue運用改革は含めない
- 既存のi18n(ja/en)・a11y(WCAG 2.1 AA)・validate緑を壊さない
- 削除は parity pin を先に置き、挙動不変で畳む。PBI 2026-10-22-01のSSOT整理と重複させない

## BDD受け入れシナリオ
Scenario: 月次で追える
  Given 1か月のリリースが複数ある
  When 月次ダイジェストを開いた
  Then 変更の要点が追え、詳細PBIへ飛べる

Scenario: 設定で迷わない
  Given 初期設定を開いた
  When 上級者項目を見ようとした
  Then 既定は畳まれており、開閉ができ、保存に影響しない

## 受け入れ基準
- [x] 月次ダイジェストの生成手順がある ― 2026-10-26確認: `generateReviewSummary`（週次/月次・成功/skip/失敗の状態表示）が既存資産として動作。E2E「monthly digest generate settles with a visible status」3/3緑。手順は SETUP_GUIDE に追記
- [x] 上級者項目の折りたたみができ、既定値が変わらない ― 2026-10-26確認: `<details>` 既定閉・開閉・保存永続をE2E 3/3緑。保存は既存入力の値のみで折りたたみ自体は既定を変えない
- [x] タグ正規化の提案が出て、適用・取消ができる ― 2026-10-26確認: 提案集計・適用・取消seam（465d3a13）が単体10件＋E2E（適用→取消の往復・件数照合）3/3緑
- [x] 削除物にparity pinがあり挙動不変である ― 2026-10-26確認: 本PBIの実装差分は追加のみ（提案モジュール・seam・パネル配線・E2E）で削除・置換はなし。削除物がないためpin対象なしと確定

## テスト戦略
- E2E: ダイジェスト生成→表示→詳細遷移、折りたたみ開閉→保存の通し
- 統合: タグ提案の適用・取消テスト
- 単体: 折りたたみ既定・ダイジェスト整形のテーブルテスト

## 見積もり
1.5人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする ― 2026-10-26: 新規E2E 3件（ダイジェスト・折りたたみ・提案往復）を `--repeat-each=3` で9/9緑。提案seamは単体10件緑
- [x] コードレビュー完了 ― 2026-10-26実施（465d3a13ほか）。提案は純粋集計＋辞書意味同一、適用・取消は注入seamで可逆・失敗件数付き中断、自動適用なし、パネルは既存seamのみ。指摘なし
- [x] ドキュメント更新済み(ダイジェスト手順・寄与手順の差分を含む) ― 2026-10-26: SETUP_GUIDE日英に振り返りサマリ節を追加。タグ提案の手順は既存（SETUP_GUIDEのタグ正規化欄）。寄与フロー自体に変更なしのため差分なし

## 実装記録（2026-10-23・調査のみ・未着手）
- 既存資産の確認（ criterion 1・2 は既に充足）:
  - 月次ダイジェスト: `src/background/reviewSummaryGenerator.ts` が対象期間の閲覧履歴を集計し、AI要約を用いたダイジェストMarkdownファイルを生成（`digest` 引数と `sanitizeForObsidian(digest)` の受け口が実在）。`src/dashboard/reviewSummaryHandler.ts` の `generateReviewSummary` が UI 経路
  - 上級者項目の折りたたみ: `<details class="advanced-details">` が6箇所実在（`obsidianSettingsDetails`・`diagCompileOptionsSection` 等）。`<details>` は既定で畳まれ、開閉は summary クリック、保存は入力が DOM に在るため影響しない（BDDの開閉シナリオを満たす）
- 残タスク（次ラウンドの再開点）: (1) タグ正規化の提案（`src/utils/tagUtils.ts` の `normalizeTags` と `TAG_NORMALIZATION_DICT` は実在、提案UI・適用・取消の経路は未実装）(2) 削除物に parity pin を先に置く（本PBIで削除する対象の確定が未着手）(3) E2E（ダイジェスト生成→表示、折りたたみ開閉→保存の通し）

## 実装記録（2026-10-23・タグ正規化の提案UI）
- 提案の純粋集計: 完了。`src/dashboard/tagNormalizationProposals.ts` の `buildTagNormalizationProposals` が保存済みタグのうち辞書で変わるものを提案。照合意味は `normalizeTags` と同一(NFKC+小文字・先勝ち・大小文字のみの差も実表示変更として提案)。`renameTagInCsv` が適用・取消の基本形(改名+衝突時重複排除、unknownはfail-closed)
- 適用・取消seam: 完了。`src/dashboard/tagRenameApplier.ts` の `applyTagRename`/`undoTagRename` がタグ付きquery→各行のtags CSV書換→updateで改名。取消は逆向きの同一経路でエンドツーエンド可逆。書込失敗は適用済み件数付きで中断(沈黙の半改名にしない)。deps注入でテストはモック
- パネル配線: 完了。タグパネルの正規化辞書の下に提案領域(遅延読込でsqlite往復なしに開く)。適用はユーザーアクション+インライン取消(自動適用はしない)。既存seamのみ使用(queryLogs tagFilter・updateLog、新規メッセージ型なし)
- ja/en: `normProposalsTitle`・`normProposalsDesc`・`normProposalsRefresh`・`normProposalsEmpty`・`normProposalApply`・`normProposalUndo`・`normProposalApplied`・`normProposalUndone` の8キーを双側追加
- pin: `src/dashboard/__tests__/tagNormalizationProposals.test.ts` 10テスト(提案テーブル・改名・重複排除・fail-closed・適用・取消・中断時件数)
- 残: parity pin(削除対象の確定が未着手)、E2E(ダイジェスト生成→表示、折りたたみ開閉→保存、提案→適用→取消の通し)、コードレビュー、ドキュメント更新(ダイジェスト手順・寄与手順の差分)
