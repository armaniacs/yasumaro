# PBI: タグ畳み込み fold の SSOT 化

## ユーザーストーリー

保守担当者として、タグ正規化の畳み込み式を1箇所に集めたい。なぜなら NFKC + 小文字化の仕様が変わったとき3箇所を同期させる必要があり、PBI 2026-10-23-05 の parity pin が物語るように同期漏れは実害になるから。

## 優先度

- 順位: 01 / 全12件
- RICE スコア: 52（Reach = 13 / Impact = 2 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: 実測10箇所の同一式。Impact 2 は将来の正規化仕様変更時の同期漏れ防止。タグ照合意味の fix 群（対象外 O6/O8）は本 PBI の畳み込みに乗るため先行させる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 畳み込み結果が変更前と同一
  Given 正規化辞書と保存済みタグがある
  When 提案・適用・重複検査を実行する
  Then 変更前と同一の提案・適用・警告が返る

Scenario: 空白・全角・大文字の境界
  Given " ＡＩ " と "ai" が混在する
  When 畳み込み共有後に判定する
  Then 両者は同一キーとして扱われる
```

## 受け入れ基準

- [x] `trim().normalize('NFKC').toLowerCase()` の直書きが tagUtils・proposals・tagsPanel から消える
- [x] 既存テスト（tagUtils・tagNormalizationProposals・tagsPanel 系）が全緑

## テスト戦略（t_wada スタイル）

- E2E: なし（純粋関数の置換のみ）
- 統合: tagsPanel の重複警告フローが共有 fold で発火するテスト
- 単体: 共有 fold の table テスト（全角・空白・空文字・非文字列は fail-closed）

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし（先行 PBI なし。対象外 O6/O8 の fix 群は本 PBI の後に実施）
- 配置先: Layer 0（`src/utils/` の純粋関数。`tagUtils.ts` が既に Layer 分類上の受け皿）
- 非機能要件: 挙動不変（式は同一のため到達可能な判定は変わらない）

## 変更点の概要

タグ畳み込み `trim → NFKC → lowercase` を Layer 0 の共有関数に切り出し、3モジュールの直書きを置換する。

## 現状と問題（file:line 付き）

- `src/utils/tagUtils.ts:153,163,166` ― `normalizeTags` 内に同一式が3箇所直書き
- `src/dashboard/tagNormalizationProposals.ts:24-26` ― private `foldTag` に同一式（ファイル内5使用: L40,46,67,71,78）
- `src/dashboard/tagsPanel.ts:194-195` ― 重複検査に同一式が2箇所直書き
- 呼び出し元実数: tag 系直書き計10箇所 + 本番消費者 `privacyPipeline.ts:304`（normalizeTags）・`tagRenameApplier.ts:72`（renameTagInCsv）
- 前回 PBI 2026-10-20-21（残り DRY 集約）と同一主題の残差。新規性は 10-23 差分で proposals/tagsPanel 側が増えた点。

## 変更の理由（DRY）

同じ理由（正規化仕様の変更）で同時に変わる関係であり、共通化は過度な抽象化ではない。YAGNI フィルタ通過。

## 提案コード（骨子のみ）

```typescript
// src/utils/tagFold.ts (Layer 0, 新設。名前は仮)
export function foldTagForMatch(tag: string): string;
// src/utils/tagUtils.ts: normalizeTags 内3箇所 → foldTagForMatch に置換
// src/dashboard/tagNormalizationProposals.ts: private foldTag を削除し import に置換
// src/dashboard/tagsPanel.ts:194-195 → foldTagForMatch に置換
```

## 実装者向け注記

```bash
grep -rn "normalize('NFKC').toLowerCase()" src/ --include='*.ts' | grep -v __tests__
```

- `normalizeTags` の「最初一致優先・重複排除」意味は変えない（fold の切り出しのみ）
- 置換後に上記 grep が共有関数の定義1件のみになることを確認する

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過（tagUtils・tagNormalizationProposals・tagsPanel 系）
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み（CONTEXT.md の用語追加は不要。必要なら本 PBI に記録）
