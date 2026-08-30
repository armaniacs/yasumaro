# PBI: クレンジング74回走査の1パス集約を計測検証する

## ユーザーストーリー

開発者として、クレンジングの74回 `querySelectorAll` を1回に集約した場合の実測効果を知りたい。なぜなら `blog-6_5` で「集約はリスクがリターンに見合わない」と判断されたが、実測データなしの推測であり、計測がなければ最適化の是非を判断できないから。

## 優先度

- 順位: 04 / 15
- RICE: Reach 5 / Impact 2 / Confidence 0.8 / Effort 1日 = 8.0
- 根拠: 実装ではなく計測。Effortは小さくConfidenceは高い。結果次第で後続の最適化PBIの優先度が決まるEnabler。

## 背景

- 現行: 全ONで74回、デフォルト(7ON)で21回の `querySelectorAll`。`buildClassIdSelectors` の文字列生成はモジュール初期化時キャッシュで解消済みだが、走査回数は未削減。
- 課題: 各strip関数が独立してDOM走査するため、同一要素が複数回マッチ判定される。`blog-6_5` では「全面リファクタは見送り」とされたが、実測なし。
- 機会: `performance.mark` / `performance.measure` で現行と1パス試作を計測比較するだけの計測専用ビルドを作れば、数時間で定量判断できる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 現行の走査回数と実行時間を計測できる
  Given 1000要素のテストDOMがある
  And 全32ルールONの CleansingConfig がある
  When 現行 cleanseAISummaryContent を performance.mark で計測する
  Then querySelectorAll呼び出し回数と実行時間(ms)が出力される

Scenario: 1パス試作の効果を比較できる
  Given 同一DOMと同一configがある
  When 1パス集約版 cleanseAISummaryContentSinglePass を計測する
  Then 現行比の実行時間と削除要素数の差分がレポートされる
  And 削除要素数の差分が0である(同等の削除結果)

Scenario: 計測レポートが残る
  Given 計測が完了した
  When レポートを出力する
  Then docs/ または dev-docs/ に計測結果mdが残り、後続PBIの判断材料になる
```

## 受け入れ基準

- [ ] 現行 `cleanseAISummaryContent` の `querySelectorAll` 呼び出し回数をカウントするインストルメントが追加される(計測時のみ有効)
- [ ] `performance.mark` / `measure` で実行時間を計測するベンチマークスクリプトが `scripts/` または `__tests__/` に作成される
- [ ] 1パス試作版( `querySelectorAll('*')` 1回 + Map分類 )のPoCが作成され、同一DOMで削除結果が一致することをテストで示す
- [ ] 計測レポート(実行時間, 呼び出し回数, 削除数, DOMサイズ別)が `dev-docs/` に残る
- [ ] 計測結果に基づき「集約すべき/すべきでない」の判断がPBIに追記される
- [ ] `npm run validate` が通る(PoCはテストコードとして隔離)

## テスト戦略

### E2E
- なし

### 統合
- ベンチマークスクリプトを `vitest` で実行し、100/500/1000/5000要素のDOMサイズ別に計測

### 単体
- PoC の1パス版が現行版と同一の `AiSummaryCleanseResult` を返すことを単体テストで検証( `stripCore.test.ts` 相当のケースを流用 )
- 計測インストルメント自体のテスト(カウントが正しいこと)

## 実装アプローチ

- **Spike**: 実装ではなく計測。`src/utils/aiSummaryCleaner/__tests__/benchmark.test.ts` 的なファイルを作成し、REDは不要
- 1. 現行コードに `performance.mark` を一時追加するブランチを作成
- 2. `scripts/benchmark-cleansing.mjs` で jsdom 環境で計測実行
- 3. 1パスPoCを `src/utils/aiSummaryCleaner/singlePass.poc.ts` に作成(本番には含めない)
- 4. 計測結果を `dev-docs/dig-findings-2026-08-30-cleansing-benchmark.md` に記録

## 見積もり

1pt (計測0.5 + PoC0.5)

## 技術的考慮事項

- 依存: なし
- テスタビリティ: jsdom での計測は実ブラウザと差があるため、参考値として扱う。可能なら Playwright で実ブラウザ計測も検討
- 非機能: PoCは本番コードに含めない。計測用ブランチで完結

## 実装者向け注記

### 現状コードの確認
```bash
grep -c "querySelectorAll" src/utils/aiSummaryCleaner/stripCore.ts src/utils/aiSummaryCleaner/stripExtended.ts
grep -rn "buildClassIdSelectors" src/utils/aiSummaryCleaner/
```

### 実装手順
1. `src/utils/aiSummaryCleaner/index.ts` の `cleanseAISummaryContent` に計測フックを追加(環境変数でON/OFF)
2. `scripts/benchmark-cleansing.mjs` を作成し、jsdomでDOM生成→計測→レポート出力
3. `singlePass.poc.ts` に1パス版を作成し、同一テストケースで結果一致を検証
4. レポートを `dev-docs/` に保存し、判断をPBIに追記

### 落とし穴
- jsdom の `querySelectorAll` は実ブラウザより遅い/速い場合がある。絶対値ではなく比率で判断する
- `Blob` による `bytesBefore/bytesAfter` 計測は `TextEncoder` に置換済みの箇所と混在しているため、バイト数基準を統一する

## Definition of Done

- [ ] 全BDDシナリオが自動テスト/スクリプトとして実装されパスする
- [ ] 計測レポートが `dev-docs/` に残る
- [ ] 後続の最適化判断が文書化される
- [ ] ドキュメント更新済み
