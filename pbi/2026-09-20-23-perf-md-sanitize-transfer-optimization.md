# PBI: md-sanitize の転送最適化でベンチを反転させ dark-launch を解除する

## ユーザーストーリー

履歴エクスポート利用者として、エクスポート操作の待ち時間を実際に短くしたい、なぜなら md-sanitize の WASM コアはパリティ込みで完成・配布済みだが、転送コスト（wasm-bindgen の UTF-8 encode/decode コピー）が支配的でベンチが全サイズで TS 負け（0.31x〜0.77x）のため、本番トラフィックが dark-launch（全サイズ TS ルーティング）のままだから

## 優先度

- 順位: 1 / 1（md-sanitize フォローアップ）
- RICEスコア: 4.0（Reach=4 / Impact=2 / Confidence=50% / Effort=1週）
- 根拠: 現状の TS でも 2000 エントリ ≈ 5.2ms と小さく、効果は「ベンチが反転した場合」に限定される。ゼロコピ incoming（TextEncoder → WASM メモリ直書き → ポインタ渡し）で転送コストを排除できれば反転の見込みはあるが、wasm-bindgen の文字列境界を手書きに置き換える工数とリスクがあり Confidence 50%。**本 PBI は判定が成果物**: 反転しなければ dark-launch 維持で誠実に閉じる

## ビジネス価値

ベンチが反転すればエクスポート集計（2000×0.5KB: TS 5.2ms → WASM 8.1ms が逆転）と将来の大量出力経路の高速化。反転しない場合も、転送コストの内訳を実測で記録して次の意思決定（レイヤー削減・レイジー移植中止）の根拠にする

## BDD受け入れシナリオ

```gherkin
Scenario: 転送最適化で本番サイズが逆転する
  Given ゼロコピ（または共有メモリ）入力に置き換えた WASM 経路
  When 2000×0.5KB のバッチベンチを実行する
  Then 本番経路の speedup が 1.0x を超え、parity が全ケース true のままである

Scenario: 反転したら dark-launch を解除する
  Given ベンチが本番サイズで 1.0x を超えた
  When markdownSanitizerHybrid の閾値を実測 crossover から再設定する
  Then エクスポート経路が WASM を使い、失敗時は従来通り TS フォールバックする

Scenario: 反転しなければ誠実に閉じる
  Given 最適化後も speedup が 1.0x 未満である
  When 実測表を添えて判断を記録する
  Then dark-launch を維持し、本 PBI は「移植不要の確定判断」としてクローズする
```

## 受け入れ基準

- [ ] 転送候補（TextEncoder+ptr 直書き / serde 経由のバイト配列 / 共有メモリ）をプローブで実測比較し、表を記録する
- [ ] 採用案でベンチを取り直し、single 128B〜128KB + batch 100/2000/10000 の全行を本番経路で報告する（不利な数値もそのまま）
- [ ] parity スイート（`src/wasm/md-sanitize/__tests__/`）が全ケース green のまま維持される
- [ ] ベンチが反転した場合: `MIN_WASM_CHARS` / `MIN_WASM_TOTAL_CHARS` を実測 crossover から再設定し、wasm-success スイートを新閾値に追従させる
- [ ] 反転しなかった場合: 実測表を添えて dark-launch 維持を判断記録し、本 PBI をクローズする
- [ ] `npm run validate` が green

## テスト戦略（t_wadaスタイル・Outside-In）

### 統合テスト

- ハイブリッド wasm-success（大入力必須 — 閾値変更時に無意味化しないよう入力サイズを追従）
- エクスポート経路の既存テスト（表示等価）

### 単体テスト

- `cargo test`: 転送層の変更に伴うコア単体の再確認
- パリティスイート（攻撃パターン込み）

## 技術的考慮事項

- 現状の dark-launch 状態: `MIN_WASM_CHARS = 1_048_576` / `MIN_WASM_TOTAL_CHARS = 2_097_152`（`src/utils/markdownSanitizerHybrid.ts`）— 本番の全入力は TS 経路。WASM 経路は CI 同等性ゲートと wasm-success で保守されている
- 攻撃パターン（javascript: リンク・wikilink・生 HTML・エンティティ二重エンコード）のパリティは既に固定済み — 転送変更で壊してはならない
- 同期呼び出し元（reviewSummaryGenerator・markdownFormatter）の配線は本 PBI のスコープ外（閾値解除後の別ステップ）

## 見積もり

1週（要チームでの見積もり）
