# PBI: 内蔵AI client実体の共有化

## ユーザーストーリー

保守担当者として、内蔵AIの到達判定を1実体に集めたい。なぜならlocal/slotで別実体（別availabilityキャッシュ）が動き、寿命・設定の変更点が分散するから。

## 優先度

- 順位: 03 / 全8件
- RICE スコア: 8（Reach = 5 / Impact = 2 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: NN02 と同点のため、鍵喪失級の NN02 を先に置く。Confidence 0.8 は dual-adapter 裁定境界のため置換ADR要否を先に確認する。NN04 は本 PBI の後に実施（RemoteAIServiceに触れるため）。

## ビジネス価値

availability判定・cache・設定が1実体に集まり、両adapterが同じ振舞いを読む。

## BDD受け入れシナリオ

```gherkin
Scenario: 両経路が同一実体を読む
  Given 内蔵AI設定がある
  When local/slot両経路で判定する
  Then 同一の到達判定が返る

Scenario: 入口併存が保たれる
  Given 両入口がある
  When 使う
  Then ADRの併存・意味の違いが保たれる
```

## 受け入れ基準

- [x] 共有clientがmanifestの1 entryに登録され、両方に同じ実体が流れる
- [x] 死んだ設定欄（RemoteAIService.ts:26）を消すか使うか決める
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 両経路の到達判定テスト

### 単体テスト
- 共有実体のtableテスト

## 実装アプローチ

- **Outside-In**: 共有の失敗テストを先に書き、赤を確認してから流す

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: NN04 は本 PBI の後に実施。置換ADR要否を先に確認する（dual-adapter裁定の境界）
- 非機能要件: 両入口の併存・testConnectionの意味の違いを保つ（統合ではない）

## 変更点の概要

共有clientをmanifest entry化し、factoryと生成seamに同実体を流す。

## 現状と問題（file:line 付き）

- `src/background/ai/aiServiceFactory.ts:22-36` ― 未使用のseam
- `src/background/compositionManifest.ts:111-115` ― remoteのみ渡す
- `src/background/ai/providers/BuiltInAiProvider.ts:37-48` ― 独自client構築
- `src/background/ai/LocalAIService.ts:25-32` ― 別実体
- `src/background/ai/RemoteAIService.ts:26` ― 死んだ設定欄

## 変更の理由（locality）

寿命・設定の変更点分散。共有で集約する（統合ではなく実体共有）。

## 提案コード（骨子のみ）

```typescript
// manifestに共有client entryを追加し、factory＋生成seamに注入する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "builtInAiClient\|BuiltInAiProvider\|availability" src/background/ai/aiServiceFactory.ts src/background/compositionManifest.ts | head -20
```

### 落とし穴

- ADR 2026-09-17 の併存裁定を再審理しない（共有のみ・統合なし）
- 置換ADR要否を先に判断して記録する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
