# PBI: repository 既定経路の実物検証

## ユーザーストーリー

保守担当者として、既定経路が本番の振る舞いと一致することを確かめたい。なぜなら現行テストは簡易 mock 相手で、本番仕様の変更が緑のまま素通りするから。

## 優先度

- 順位: 11 / 全11件
- RICE スコア: 2.1（Reach = 2 / Impact = 1 / Confidence = 0.8 / Effort = 0.75人日）
- 根拠: テストの実効性向上。NN07 と同テストファイルに触れるため本 PBI を後に実施する。

## ビジネス価値

検証しない既定経路は将来の仕様変更で黙って壊れる。実物検証で素通りを防ぐ。

## BDD受け入れシナリオ

```gherkin
Scenario: 既定経路が本番と一致する
  Given 本番 SettingsRepository がある
  When 既定経路で保存・読込する
  Then 既定補完などの本番仕様と同一に振る舞う

Scenario: 既存テストは緑のまま
  Given 既存テストがある
  When 実物検証を足す
  Then 全件が緑になる
```

## 受け入れ基準

- [x] 既定経路のテストが実物（または実物相当）相手に変わる
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 実 SettingsRepository + InMemoryStorageAdapter での既定経路テスト

### 単体テスト
- 既存 pure テスト維持

## 実装アプローチ

- **Outside-In**: 実物相手の失敗テストを先に書き、赤を確認してから直す

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: NN07 の後に実施（同テストファイル）
- 非機能要件: 本番コードの変更なし（テストのみ。必要なら seam の既定値を見直す）

## 変更点の概要

既定経路テストを簡易 mock から実物相手に寄せる。

## 現状と問題（file:line 付き）

- `src/utils/storage/__tests__/savedCollectionsRepository.test.ts`・`domainIntelRepository.test.ts` の既定経路テストが簡易 mock 相手で、本番の既定補完などを検証しない

## 変更の理由（テスト容易性）

検証しない経路は仕様変更の素通りを許す。round2 で作った seam の既定値を活かす。

## 提案コード（骨子のみ）

```typescript
// 既存の注入 suite 流儀（実 SettingsRepository + InMemoryStorageAdapter）を
// 既定経路テストにも適用する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "vi.mock.*SettingsRepository" src/utils/storage/__tests__/savedCollectionsRepository.test.ts src/utils/storage/__tests__/domainIntelRepository.test.ts
```

### 落とし穴

- 実時間待ち禁止（TEST_RULE 準拠）。本番コードを変えない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
