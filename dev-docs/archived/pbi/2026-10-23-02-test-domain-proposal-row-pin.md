# PBI: ドメイン提案の複数行テスト強化

## ユーザーストーリー

保守担当者として、O1 修正の錠を効かせたい。なぜなら現行の2行テストは発火回数・1行目非干渉を見ておらず、誤配線の回帰が素通りするから。

## 優先度

- 順位: 02 / 全11件
- RICE スコア: 13.3（Reach = 2 / Impact = 2 / Confidence = 1.0 / Effort = 0.3人日）
- 根拠: 出荷したばかりの O1 修正の回帰防止（実害の再発防止のため Impact 2）。

## ビジネス価値

O1（複数行の誤配線）は実害バグだった。その回帰を検出できないと再発する。テスト強化で修正が保たれる。

## BDD受け入れシナリオ

```gherkin
Scenario: 各行が独立に発火する
  Given 提案が2件ある
  When 2行目の適用を押す
  Then 書込みが1回だけ対応ドメインで呼ばれ、1行目は無変化のままになる

Scenario: 1行目の操作が2行目に干渉しない
  Given 提案が2件ある
  When 1行目の適用を押す
  Then noisy.com で1回だけ呼ばれ、2行目の状態は変わらない
```

## 受け入れ基準

- [x] `toHaveBeenCalledTimes(1)` と1行目非干渉（status 空・非 disabled）の assert がある
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- ドメイン panel の2行独立テストを既存 pin ファイルに拡張する

### 単体テスト
- なし（統合で覆う）

## 実装アプローチ

- **Outside-In**: assert を先に足して赤を確認する（旧形状なら落ちること）。現行コードで緑になることを確認する

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし（NN01 と同 panel に触れるが別テストファイルのため並列可）
- 非機能要件: 本番コードの変更なし（テストのみ）

## 変更点の概要

既存の2行テストに発火回数と非干渉の assert を足す。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/__tests__/domainAnalysisPanel-proposalPin.test.ts:148-180` ― 2行目の status と `toHaveBeenCalledWith('loud.com')` のみで、回帰検出に不足

## 変更の理由（テスト容易性）

last-proposal-wins 型の誤配線回帰は現行テストを素通りする。錠が効いていない修正は実質未保護。

## 提案コード（骨子のみ）

```typescript
// 既存テストに以下を足す:
expect(mockAddToBlacklist).toHaveBeenCalledTimes(1);
// 1行目の status が空・apply が非 disabled のままであること。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "toHaveBeenCalledTimes\|toHaveLength(2)" src/dashboard/panels/asyncData/__tests__/domainAnalysisPanel-proposalPin.test.ts
```

### 落とし穴

- 本番コードを変えない（assert 追加のみ）。赤になる場合は本番の回帰であり、別途 fix として扱う

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
