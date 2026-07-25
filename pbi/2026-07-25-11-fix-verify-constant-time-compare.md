# PBI: constantTimeCompare のフォールバック実装が実ブラウザで定数時間か検証する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟡中（2pt目安、計測作業を含む）
**副作用**: 🟢なし（検証のみ。問題があれば追加PBIとして切り出す）

---

## 背景

Checking Team レビュー（2026-07-25）の Blue Team Leader からの指摘。`src/utils/crypto.ts:58-91` の `constantTimeCompare()` は `crypto.subtle.timingSafeEqual` が利用不可の場合、文字ループによる自前フォールバック実装（74-90行）を使用する。理論上はタイミング安全な設計だが、V8エンジンの最適化（JIT、分岐予測、短絡評価）により実際に定数時間性が保たれているかはコードを読むだけでは確認できない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "timingSafeEqual\|constantTimeCompare" src/utils/crypto.ts
```

`webcrypto.subtle.timingSafeEqual` は執筆時点でSafari/Firefoxでの対応が限定的なため、Chrome拡張の実行環境（Chromium）でこのAPIが利用可能かどうかも合わせて確認する。利用可能であればフォールバックパス自体が実行されないため、このPBIの緊急度は下がる。

## 受け入れ基準（BDD）

```gherkin
Scenario: フォールバック実装のタイミング特性を測定する
  Given crypto.subtle.timingSafeEqual が利用不可の環境をシミュレートする
  When 異なる位置で異なる文字列ペア（早期不一致 vs 後方不一致）を1000回以上比較する
  Then 比較時間の分布に統計的に有意な差がないことを確認する

Scenario: 測定結果に基づき対処方針を決定する
  Given タイミング測定の結果
  When 有意な時間差が検出された場合
  Then 追加の緩和策（定数時間実装の見直し、ライブラリ採用）を検討するPBIを別途起票する
```

## 受け入れ基準
- [ ] Chrome実ブラウザ環境で `constantTimeCompare` のフォールバックパスの実行時間を計測するベンチマークスクリプトを作成する
- [ ] 早期不一致文字列と後方不一致文字列で計測し、統計的な時間差の有無を報告する
- [ ] `chrome.runtime` 環境で `crypto.subtle.timingSafeEqual` が利用可能か確認する
- [ ] 結果を `dev-docs/ADR/` にADRとして記録する（対策不要 or 追加対策が必要、いずれの場合も）

## テスト戦略

### 統合テスト
- ベンチマークスクリプトは自動テストではなく手動実行の計測ツールとして作成（`scripts/` 配下）

### 単体テスト
- 既存の `constantTimeCompare` のロジックテスト（正しく一致/不一致を判定するか）は変更しない

## 実装アプローチ

1. `scripts/benchmark-constant-time-compare.mjs` のような計測スクリプトを作成
2. 短い文字列・長い文字列、一致・不一致、不一致位置（先頭/末尾）を組み合わせて計測
3. 統計処理（平均・分散・t検定など簡易的なもの）で有意差を判定
4. 結果を ADR としてまとめる

## 見積もり

2pt（計測スクリプト作成 + 実行 + 分析 + ADR記載）

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: セキュリティ（タイミング攻撃耐性の実証）

## Definition of Done
- [ ] 計測スクリプトが作成されている
- [ ] 実ブラウザでの計測結果が記録されている
- [ ] ADRとして結論（対策要否）が文書化されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Blue Team Leader指摘）
- 対象コード: `src/utils/crypto.ts:58-91`
