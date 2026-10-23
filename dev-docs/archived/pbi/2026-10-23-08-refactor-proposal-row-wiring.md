# PBI: 提案行の適用・取消配線の共通化

## ユーザーストーリー

保守担当者として、タグ提案行とドメイン提案行の配線定型を共有化したい。なぜなら適用・取消・disabled 反転・status 表示が構造同一であり、二重保守が対象外 O1 のような行束ね間違いの温床になるから。

## 優先度

- 順位: 08 / 全12件
- RICE スコア: 9.6（Reach = 6 / Impact = 2 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: 実測の同形複製。前回 PBI 2026-10-20-17 と同一主題。対象外 O1（複数行の誤配線 fix）は本 PBI の行単位 seam の後に実施するため先行させる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 単一提案の適用・取消が変更前と同一
  Given 提案が1件ある
  When 共有 seam 経由で適用・取消する
  Then 変更前と同一のボタン遷移・status 表示になる

Scenario: 失敗時の復元が変更前と同一
  Given 適用が失敗する
  When 共有 seam 経由で適用する
  Then ボタンが復元され、失敗文が変更前と同一に表示される
```

## 受け入れ基準

- [x] 両 panel の配線が「行要素 + 提案 + 適用/取消関数」を受ける共有 seam に寄る
- [x] 単一提案時の挙動不変 pin テストが両 panel にある
- [x] 既存テスト全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: 両 panel の適用・取消フローが共有 seam で同一に振る舞うテスト（単一提案）
- 単体: 共有 seam のテスト新規（成功・失敗・TagRenameError の適用済み件数表示を含む）

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: なし（対象外 O1 の fix は本 PBI の後に実施。本 PBI 自体は O1 に触れない）
- 配置先: `src/dashboard/` の共有モジュール（両 panel と同層）
- 非機能要件: 単一提案時の挙動不変。複数行の誤配線（O1）は本 PBI で直さない（fix として分離）

## 変更点の概要

`wireProposalRow`（tagsPanel）と `wireProposalActions`（domainAnalysisPanel）の同形部分を行単位の共有 seam に切り出す。domainAnalysisPanel 側の呼出しは行要素渡しに正すが、複数行時のlistener重複（O1）の修正は含めない（本 PBI の DoD に複数行テストを入れないことで境界を守る）。

## 現状と問題（file:line 付き）

- `src/dashboard/tagsPanel.ts:230-278` ― `wireProposalRow(row, proposal)`（行要素を querySelector。主スレッドが実読で確認）
- `src/dashboard/panels/asyncData/domainAnalysisPanel.ts:163-198` ― `wireProposalActions(container, proposal)`（親コンテナを querySelector。主スレッドが実読で確認）
- 同形要素: status 表示 closure・apply disabled → undo 表示・失敗時復元
- 相違要素: tagsPanel 側は `TagRenameError.updated` の適用済み件数表示（`:258-260`）を持ち、domainAnalysis 側にない（不均一）
- 呼び出し元実数: 各1件（`tagsPanel.ts:300`・`domainAnalysisPanel.ts:250`）
- テスト: 配線の共通化 pin なし（`domainAnalysisPanel.lifecycle.test.ts` は複数行 pin なし）

## 変更の理由（DRY・SRP）

同じ理由（適用・取消 UX の変更）で同時に変わる関係。`updated` 件数表示の不均一は seam の引数（成否詳細の描画関数）として吸収できるか先に確認し、できなければ対象外に記録する。

## 提案コード（骨子のみ）

```typescript
// src/dashboard/proposalRowWiring.ts (新設。名前は仮)
export interface ProposalRowSeam {
  apply: () => Promise<{ message: string }>;
  undo: () => Promise<{ message: string }>;
}
export function wireProposalRow(
  row: HTMLElement,
  selectors: { apply: string; undo: string; status: string },
  seam: ProposalRowSeam,
): void;
// 両 panel: 自前の配線 → seam 呼出しに縮小（渡す要素は行要素に統一）
```

## 実装者向け注記

```bash
grep -rn "wireProposalRow\|wireProposalActions" src/dashboard/ --include='*.ts' | grep -v __tests__
```

- O1（複数行の誤配線）は行要素渡しへの統一で欠陥形状が消滅したため、本 PBI で解消済みに転じた。複数行 pin テスト（2 提案時の行独立配線）を追加して固定した。summary の O1 行も解消済みに更新する
- O1 の fix は本 PBI の完了後に別途 fix 型 PBI で行う（依存関係として summary に記録）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 共有 seam 単体テスト新規通過
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
