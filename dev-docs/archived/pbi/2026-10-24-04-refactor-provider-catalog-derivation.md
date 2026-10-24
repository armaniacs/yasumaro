# PBI: プロバイダ追加手順の導出化

## ユーザーストーリー

保守担当者として、追加手順の暗黙順序を自動化したい。なぜなら「1行追加」の裏に4箇所の順序が隠れ、欠落がload時throwになるから。

## 優先度

- 順位: 04 / 全8件
- RICE スコア: 6.4（Reach = 6 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: NN03 の後に実施（RemoteAIServiceに触れるため）。Confidence 0.8 は導出範囲の設計判断残り。

## ビジネス価値

追加者が覚えるinterfaceは「catalogの1行」のまま、背後の整合が自動化される。

## BDD受け入れシナリオ

```gherkin
Scenario: 欠落が明示失敗になる
  Given allowlist行欠落のcatalog行がある
  When 読む
  Then 明示失敗で検出される

Scenario: 正常追加が1行で済む
  Given catalogの1行がある
  When 追加する
  Then 既定値・必須鍵まで整合する
```

## 受け入れ基準

- [x] catalog行からallowlist・既定値・必須鍵を導出または検証するseamが1箇所にある
- [x] 既存テスト全緑（parity検証を含む）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- プロバイダ生成フローテスト維持

### 単体テスト
- 導出・検証のtableテスト新規

## 実装アプローチ

- **Outside-In**: 欠落の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN03 の後に実施
- 非機能要件: 既存7行の振舞い不変

## 変更点の概要

catalog行のfactoryがallowlist行を引く形に寄せる。

## 現状と問題（file:line 付き）

- `src/background/ai/providerCatalog.ts:93-101,127-351` ― allowlist欠落でthrow＋catalog＋factory
- `src/utils/storage/providerAllowlist.ts` ― allowRow参照先
- `src/utils/storage/providerDefaultBaseUrls.ts` ― 既定値
- `src/background/ai/RemoteAIService.ts:105-131`・`aiModelKey.ts:26-31` ― slot・鍵解決
- `providerSecurityPolicy.ts:8` ― 再export

## 変更の理由（depth・locality）

「1行」の裏の4箇所順序。導出または検証で自動化する。

## 提案コード（骨子のみ）

```typescript
// catalog行のfactoryがallowlist行を引き、欠落時は明示失敗にする。
// 既存parity検証の置き場を活用する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "PROVIDER_ALLOWLIST_ROWS\|allowRow\|PROVIDER_CATALOG" src/background/ai/providerCatalog.ts | head -20
```

### 落とし穴

- 既存7プロバイダの振舞いを変えない（parityテストが緑のままであること）
- 導出か検証かを先に決めて記録する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + tableテスト新規通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
