# PBI: ブラックリスト期待値の契約統一

## ユーザーストーリー

保守担当者として、どちらの期待値が正しいか決めたい。なぜなら mock 経路と注入経路で期待値が分裂し、将来どちらを直すべきか迷うから。

## 優先度

- 順位: 07 / 全11件
- RICE スコア: 5（Reach = 2 / Impact = 1 / Confidence = 1.0 / Effort = 0.4人日）
- 根拠: テスト契約の分裂解消。NN11 と同テストファイルに触れるため本 PBI を先に実施する。

## ビジネス価値

分裂した期待値は将来の変更で片側を壊す。契約統一で迷いをなくす。

## BDD受け入れシナリオ

```gherkin
Scenario: 本番の契約に統一される
  Given 空の store がある
  When ドメインを追加する
  Then 本番の補完仕様と同一の結果（既定＋追加）が期待値になる

Scenario: 両経路の期待値が一致する
  Given 同一操作がある
  When mock 経路と注入経路で検証する
  Then 両者の期待値が同一になる
```

## 受け入れ基準

- [ ] mock 経路の期待値を本番契約（既定補完あり）に統一する
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- 期待値統一後の両経路テスト

## 実装アプローチ

- **Outside-In**: 統一後の期待値を先に書き、赤を確認してから直す

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: NN11 は本 PBI の後に実施（同テストファイル）
- 非機能要件: 本番コードの変更なし（テストのみ）

## 変更点の概要

mock 経路の期待値を本番契約に寄せる（`SettingsRepository.ts:207-217` の既定補完が正）。

## 現状と問題（file:line 付き）

- `src/utils/storage/__tests__/domainIntelRepository.test.ts:54-67` ― mock 経路は `['example.com']` を期待
- `src/utils/storage/__tests__/domainIntelRepository.test.ts:122-138` ― 注入経路は `[...defaults, 'example.com']` を期待
- 本番は既定補完のため後者が正しい（反証で確定済み）

## 変更の理由（テスト容易性）

どちらが正しいかコードから読めない分裂は、将来の変更で必ず片側を壊す。

## 提案コード（骨子のみ）

```typescript
// mock 経路の期待値を [...defaults, 'example.com'] に統一する。
// mock 自体が既定補完を再現していない場合は mock 側を直す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "example.com" src/utils/storage/__tests__/domainIntelRepository.test.ts
```

### 落とし穴

- 本番コードを変えない。赤になる場合は契約理解の誤りのため立ち止まる

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
