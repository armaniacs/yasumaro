# PBI: 応答形状の正本化

## ユーザーストーリー

保守担当者として、応答形状の正本を1 moduleに寄せたい。なぜならshape変更が types・Outcome双子・normalize・handler整形・view定義・panel詰替の複数箇所編集になるから。

## 優先度

- 順位: 02 / 全8件
- RICE スコア: 7.2（Reach = 6 / Impact = 3 / Confidence = 0.8 / Effort = 2.0人日）
- 根拠: 後続NN03・NN04の前提になるため先行させる。Confidence 0.8 は双子解消の設計判断残り。

## ビジネス価値

形状知識の分散は将来の種別追加・文言変更のコストになる。正本化で学習量と修正点が1箇所になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 形状変更が1箇所で済む
  Given 応答形状に項目が増える
  When 正本を変更する
  Then handler・view・panelの重複定義なしに全体が通る

Scenario: 実行時は変更前と同一
  Given 既存の問い合わせ応答がある
  When 処理する
  Then 変更前と同一に表示・処理される
```

## 受け入れ基準

- [x] Outcome双子の片方が消える（messaging層の正本に一本化）
- [x] scope整形がvalidatorに一本化されhandler内再検査が消える
- [x] view二重定義が解消される
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- handler dispatch経由のOutcomeテスト維持

### 単体テスト
- 正本の形状table＋validator一本化のテスト

## 実装アプローチ

- **Outside-In**: 正本の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

2pt（🟡中）

## 技術的考慮事項

- 依存関係: NN03・NN04 は本 PBI の後に実施（正本の上で組立てるため）
- 非機能要件: wire上の実行時形状は不変（型・配置の整理に留める）

## 変更点の概要

応答の正本をmessaging層の1 moduleに寄せ、handlerは返すだけ、viewは直接受け、詰替えはseam上の一つの小moduleに集約する。

## 現状と問題（file:line 付き）

- `src/messaging/types.ts:83-103,298-330` ― 共用体＋条件分岐
- `src/background/handlers/askHistoryHandlers.ts:30-33`・`src/background/researchReportGenerator.ts:52-54` ― Outcome双子
- `src/messaging/normalizeGatewayResponse.ts:28-47` ― 形状検査
- `src/background/handlers/researchReportHandlers.ts:44-57` ― scope再整形
- view二重定義（`askHistoryPanelView.ts:21,30`・`researchReportPanelView.ts:19`）＋panel詰替（`:607,637`）

## 変更の理由（depth・locality）

5箇所往復の知識分散。depth-as-leverageで正本に寄せる。

## 提案コード（骨子のみ）

```typescript
// messaging層に応答正本module（型＋検査＋scope整形の単一interface）。
// handler: 正本型を返すだけ。view: 正本を直接受ける。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "AskHistoryOutcome\|ResearchReportOutcome" src/ --include='*.ts' | grep -v __tests__
```

### 落とし穴

- wire実行時形状を変えない（ADR 2026-09-25 の逆依存判例に沿い、正本の置き場所を記録する）
- view二重定義の片方を消す際は輸入元を数えてから消す

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
