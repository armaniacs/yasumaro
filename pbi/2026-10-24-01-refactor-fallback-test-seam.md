# PBI: フォールバックtestConnectionのseam対称化

## ユーザーストーリー

保守担当者として、診断seamを生成seamと対称にしたい。なぜならtestConnectionだけ無条件remote落ちで、local診断が到達不能な死にseamになるから。

## 優先度

- 順位: 01 / 全8件
- RICE スコア: 12（Reach = 3 / Impact = 2 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: 小さい・検証しやすい・deletion testで判定できる。最初の一手。

## ビジネス価値

診断UIが1つのseamで両経路を検証でき、「どちらをテストしたか」の知識が呼び側から消える。

## BDD受け入れシナリオ

```gherkin
Scenario: 両経路が診断できる
  Given local/remoteの設定がある
  When 接続テストする
  Then 各経路の診断が返る

Scenario: availabilityと疎通の区別が保たれる
  Given 内蔵AIとremoteがある
  When 診断する
  Then 従来の区別どおりに返る
```

## 受け入れ基準

- [ ] testConnectionがmodeを受けるか、両診断を返す形に揃う
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 診断フローテスト維持

### 単体テスト
- mode×経路のtableテスト新規

## 実装アプローチ

- **Outside-In**: 失敗テストを先に書き、赤を確認してから揃える

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: ADR 2026-07-27 の availability vs 疎通の区別を保つ

## 変更点の概要

testConnectionのseamを生成seamと対称にする。

## 現状と問題（file:line 付き）

- `src/background/ai/FallbackAIService.ts:18-39` ― mode分岐（生成側）
- `src/background/ai/FallbackAIService.ts:52-57` ― 無条件remote委譲（診断側）
- `src/background/ai/LocalAIService.ts:81-117` ― 到達不能な診断
- `src/background/ai/AIService.ts:67-83` ― 3要素interface

## 変更の理由（depth）

test seamだけdepthを持たない委譲1行。揃えてdepthを与える。

## 提案コード（骨子のみ）

```typescript
// testConnectionもmodeを受けるか、両診断を返す形に揃える。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "testConnection" src/background/ai/FallbackAIService.ts src/background/ai/LocalAIService.ts | head
```

### 落とし穴

- availability vs 疎通の区別を潰さない
- 診断文面の既存テストを保つ

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + tableテスト新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
