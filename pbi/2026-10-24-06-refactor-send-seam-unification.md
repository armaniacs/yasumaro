# PBI: 送信seamの一本化

## ユーザーストーリー

保守担当者として、送信順序とretry既定を1箇所に寄せたい。なぜなら所有が2箇所・retryが3系統に分散し、新規送信者が載るseamを毎回判断するから。

## 優先度

- 順位: 06 / 全8件
- RICE スコア: 4（Reach = 5 / Impact = 2 / Confidence = 0.8 / Effort = 2.0人日）
- 根拠: NN05 と同点のため、リスク軽減効果（競争・再試行不具合の集中）で NN07 より先に置く。Confidence 0.8 は retry 統一の設計判断残り。

## ビジネス価値

制限時間契約の変更が全gatewayに一括反映され、timer漏れ・二重送信の不具合が1 seamに集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 送信が単一seamに載る
  Given 新規送信者がいる
  When 送信する
  Then 判断なしに単一seamに載る

Scenario: retry既定が一本化される
  Given retry既定を変更する
  When 1 moduleを変える
  Then 全gatewayに反映される
```

## 受け入れ基準

- [ ] 生送信がsendWithPolicyに委譲される（dashboardGatewayはtoken付与＋再発行判断のみ）
- [ ] retry既定の表が1 moduleに寄る
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- gateway経由の送信テスト維持

### 単体テスト
- retry表・競争のtableテスト

## 実装アプローチ

- **Outside-In**: 委譲後の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

2pt（🟡中）

## 技術的考慮事項

- 依存関係: なし（送信路の独立領域）
- 非機能要件: 制限時間・再試行の実効値不変（既定値の統一は値を変えない）

## 変更点の概要

dashboardGateway の生送信を委譲に縮小し、retry表を一本化する。

## 現状と問題（file:line 付き）

- `src/messaging/sendWithPolicy.ts:51-66` ― 単一seam（envelope＋制限時間＋normalize）
- `src/messaging/dashboardGateway.ts:76-149` ― 独自競争＋独自retry表＋token取得
- `src/messaging/messageTransport.ts:79-108` ― transport既定（3系統目）
- 派生3 gateway（pending・ask・research）はsendWithPolicy派

## 変更の理由（depth・locality）

ADR 2026-09-29 がAI側retryを一本化したのと対照的にmessaging送信は3系統。depth-as-leverageで寄せる。

## 提案コード（骨子のみ）

```typescript
// dashboardGateway: confirmToken付与＋再発行判断のみ残し、生送信は委譲。
// retry既定（回数・待機）の表を1 moduleに寄せる。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "retryAttempts\|retryDelay\|withRuntimeTimeout" src/messaging/dashboardGateway.ts src/messaging/sendWithPolicy.ts src/messaging/messageTransport.ts | head
```

### 落とし穴

- 実効の制限時間・再試行回数を変えない（既定値の統一は値不変が条件）
- confirmToken再発行の意味を変えない

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
