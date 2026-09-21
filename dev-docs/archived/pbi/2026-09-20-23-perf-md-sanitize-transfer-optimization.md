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

- [x] 転送候補（TextEncoder+ptr 直書き / serde 経由のバイト配列 / 共有メモリ）をプローブで実測比較し、表を記録する
- [x] 採用案でベンチを取り直し、single 128B〜128KB + batch 100/2000/10000 の全行を本番経路で報告する（不利な数値もそのまま）
- [x] parity スイート（`src/wasm/md-sanitize/__tests__/`）が全ケース green のまま維持される
- [ ] ベンチが反転した場合: `MIN_WASM_CHARS` / `MIN_WASM_TOTAL_CHARS` を実測 crossover から再設定し、wasm-success スイートを新閾値に追従させる
- [x] 反転しなかった場合: 実測表を添えて dark-launch 維持を判断記録し、本 PBI をクローズする
- [x] `npm run validate` が green

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

---

## 判定記録（2026-09-21 実施・結論: 非反転 → dark-launch 維持でクローズ）

### 転送候補の実測比較（bench/pbi23-transfer-probe.ts → bench/pbi23-transfer-probe-result.json）

実装した転送アーム（いずれも改行安全 — (a)(a2)(c) は長さ区切りの
`[u32LE len][UTF-8]...` フレームで `\n` はペイロード扱い、(b) はバイト配列。
tag-cooccur 式の `\n` 連結＋split ゲートは不採用を維持）:

| アーム | 内容 |
|---|---|
| W0（現行本番） | serde_wasm_bindgen 文字列配列（`sanitizeBatch`） |
| A（framed bytes） | TextEncoder → 単一 Uint8Array 直書き（ptr+len）→ WASM、戻りもバイトで受け JS 側 decode |
| A2（framed+join） | framed 入力＋単一 String 出力（export 集約の形） |
| B（serde bytes） | 事前エンコード済み Uint8Array 配列を serde `Vec<Vec<u8>>` で往復 |
| C（shared staging） | A と同一 Rust 経路＋JS 側 staging バッファを使い回し（encodeInto・共有メモリ模擬） |
| floor（参考） | encode×N＋decode×N のみ（WASM 呼び出し無し）— 転送が原理的に払う下限 |

batch 100×0.5KB（30 ops）：

| 経路 | ms/op | speedup vs TS |
|---|---|---|
| TS map | 0.291 | 1.00x |
| W0 現行 | 0.459 | 0.63x |
| A framed | 0.339 | 0.86x |
| A2 framed+join | 0.311 | 0.93x |
| B serde bytes | 11.755 | 0.02x |
| C shared staging | 0.288 | 1.01x（再測 0.95x — ノイズ） |
| floor codec | 0.033 | — |

batch 2000×0.5KB（本番 PBI サイズ・10 ops、再測つき）：

| 経路 | ms/op（初回 / 再測） | speedup vs TS（初回 / 再測） |
|---|---|---|
| TS map | 5.041 / 4.709 | 1.00x |
| W0 現行 | 8.147 / 7.912 | 0.62x / 0.60x |
| A framed | 6.103 / 6.151 | 0.83x / 0.77x |
| A2 framed+join | 6.614 / 6.411 | 0.76x / 0.73x |
| B serde bytes | 237.394 / 233.462 | 0.02x / 0.02x |
| C shared staging | 5.830 / 5.817 | 0.86x / 0.81x |
| floor codec | 0.712 / 0.709 | — |

batch 10000×0.2KB（3 ops、再測つき）：

| 経路 | speedup vs TS（初回 / 再測） |
|---|---|
| W0 現行 | 0.63x / 0.64x |
| A framed | 0.69x / 0.72x |
| A2 framed+join | 0.31x→0.73x（初回は 3-iter の GC ノイズ、再測で収束） |
| B serde bytes | 0.02x / 0.02x |
| C shared staging | 0.71x / 0.88x |

single パスは測定対象外とした — 現行の単一文字列経路は既に
passStringToWasm0/getStringFromWasm0 の直接 ptr+len であり、候補 (a) と
同一構成のため転送上の改善余地がない。本番経路の再計測（bench.ts・新バイナリ）:
single 128B→128KB 0.20x〜0.83x、batch 0.57x / 0.66x / 0.63x、
全行 parity OK（従来の bench-result.json と同型・上書きせず温存）。

### パリティ検証（転送変更で意味論を壊していないこと）

- 攻撃コーパス全 arm OK: `[t](javascript:alert(1))`・`HTTPS` 大文字スキーム・
  `[[[a](https://x)]]` 左端消費・`<script>` 生 HTML・`&lt;`/`&amp;` 二重
  エンコード・`🎉`/あいう/全角の非 BMP・埋め込み改行・空文字列・敵対的
  separator（`]()&<>` 含む 4 種）
- framed 経路の randomized differential（200 入力・改行/マルチバイト多め）OK
- UTF-8/UTF-16 意味論差なし: 新旧どちらの経路も JS 側 TextEncoder/
  TextDecoder を通るため、lone surrogate → U+FFFD の振る舞いを含め同一。
  parity スイートは lone surrogate を従来どおり対象外とする
- `cargo test` 13 件 green（既存 11＋フレーム往復/切詰エラー 2 件の新規）
- parity＋hybrid＋wasm-success＋markdown/export スイート green、
  fresh/committed parity・src/public cmp・glue stale の CI ゲート相当を
  ローカル再現して green、`npm run validate` green（12761 件 pass）

### 判定: 非反転（NON-FLIP）

- 本番サイズ（2000×0.5KB）で最良アーム C でも 0.81x〜0.86x に留まり、
  受諾条件の speedup > 1.0x に 2 回の測定とも届かない
- B（serde バイト配列）は 0.02x で論外 — `Vec<Vec<u8>>` が JS 数値配列に
  展開される serde の表現コストが支配的。診断的価値のみ
- A/A2/C で serde リフレクション分（W0 0.60x → A 0.77〜0.83x）は実際に
  削れたが、残る UTF-8 transcoding＋スキャン自体が V8 ビルトインに勝てない。
  floor 計測（PBI サイズで TS 全体の約 14%）が示すとおり、転送をゼロに
  してもコア計算が約 1:1 のメモリ帯域勝負になる構造は変わらない
- よって「転送最適化で反転させる」仮説は棄却する

### 着陸内容

- dark-launch 維持: `MIN_WASM_CHARS = 1_048_576` /
  `MIN_WASM_TOTAL_CHARS = 2_097_152`・ハイブリッド配線・
  `src/wasm/md-sanitize/index.ts` はすべて不変。
  wasm-success スイートの追従も不要（閾値不変のため空洞化なし）
- 追加した Rust エクスポート（`sanitizeBatchFramed` /
  `sanitizeBatchFramedAndJoin` / `sanitizeBatchBytes`）と再生成 glue/
  バイナリ（+7,619B / +11.8%）は計測インフラとして残す。
  本番経路（index.ts・hybrid）はこれらを呼ばない。
  将来「移植不要の確定判断」を見直す際は bench/pbi23-transfer-probe.ts の
  再実行で本記録を再検証できる
- bench-result.json は温存（新バイナリでの本番経路再計測が同型を確認済み）
- 本 PBI は「移植不要の確定判断」としてクローズする。
  将来の再訪は転送層ではなく、計算自体の削減（呼び出し回数削減・
  サニタイズ不要部のスキップ等）の方向でのみ意味がある
