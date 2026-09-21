# PBI: WASM ハイブリッドの共通 runtime を新設し probe/guard/fallback/remap を1箇所に集約する

## ユーザーストーリー
開発者として、WASM コアを追加するときの定型(可用性プローブ・引数ガード・フォールバック・インデックス再マップ)を1箇所で書きたい、なぜなら3ファイルの逐語コピーは4つ目のコア追加コストと手順漏れ(dedup public コピー延期による 404 状態)の温床だから

## 優先度
- 順位: 2 / 5
- RICEスコア: 6.4（Reach=8 / Impact=1 / Confidence=80% / Effort=1.0週）
- 根拠: 現在3ファイルが動いているため Impact は 1 だが、テキスト処理クラスタは直近最多変更領域で、dedup 本番統合(コミット 0ed11095 の NOTE)の着手が近い。統合の直前に runtime を整えると二度手間が消える。旧候補5(インデックス再マップ契約)を統合 — split ゲートの所有者はこの runtime に宿るため

## ビジネス価値
4つ目の WASM コア追加コストが「儀式コピー ~100行 + 手順4点」から「コア呼び出し + 固有ポリシー」に減る。ログ方針・ガード意味論・split ゲートの修正が1箇所に集約される(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: split 不一致で TS フォールバックに落ちる
  Given WASM コアが text を indices + count で返す
  When 呼び出し側の split 総数が count と不一致である
  Then 警告ログ1件とともに TS リファレンスの結果を返す(静かな誤マッピングは起こさない)

Scenario: option 域外は TS 経路へ迂回する
  Given threshold が NaN / minLength が u32 域外である
  When ハイブリッドを呼び出す
  Then WASM を呼ばず TS リファレンスで処理する

Scenario: 3ハイブリッドが同一 runtime を使う
  Given pii・textrank・dedup の3ハイブリッド
  When 実装を読む
  Then probe・guard・fallback・remap は共有 runtime の1実装のみを参照する

Scenario: PII サイズ上限エラー文字列が1箇所で定義される
  Given サイズ上限を超える入力
  When TS 経路と WASM 経路それぞれで処理する
  Then 両経路のエラーメッセージが同一文字列定数から生成される
```

## 受け入れ基準
- [x] 共有 hybrid runtime モジュール(probe / u32+非有限ガード / fallback ログ / remap 契約)が新設される → `src/utils/wasmHybridRuntime.ts` (createHybridProbe / isWasmSafeU32+isWasmSafeF64 / logWasmFallback+withWasmFallback / remapWasmIndices)
- [x] 3ハイブリッドが runtime を利用し、重複儀式(~100行 ×3)が消える → 各 hybrid の isWasmAvailable/U32_MAX/catch-warn-addLog を削除し runtime 参照に置換
- [x] remap 契約は splitter 関数注入で per-core 差分(trimmed vs delimiter 付き)を吸収する → 呼び側が split 済み配列を渡す remapWasmIndices(result, parts, core, unit); textrank=splitSentences/sentences, dedup=splitSentencesKeepDelimiters/parts
- [x] PII のサイズ上限エラー文字列(MAX_INPUT_SIZE/MAX_SKIP_SIZE/MAX_OUTPUT_SIZE)が1箇所から供給される → piiInputSizeError/piiOutputTruncationError (定数は piiSanitizer.ts の export から供給; hybrid 側の手動再現テンプレート削除)。契約テストで TS 経路との文字列一致を pin
- [x] per-core 固有ポリシー(PII サイズ上限再現、textrank topK quirk、dedup threshold-0/4KB フロア/fail-open cap)は各ファイルに残る → isWasmSafeOptions・早期リターン・shapeItems は各 hybrid に保持
- [x] 全出力が byte 等価(既存パリティ・契約テスト green) → スコープテスト 8 ファイル 355 件 green (契約 12 + runtime 単体 16 + wasm-success 3 + parity 3)。旧3 unavailable-path suite は契約 suite に吸収(失敗キャッシュ断言が新 probe 契約と矛盾するため削除)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- 全コア共通の契約 suite: split 不一致→fallback、範囲外→fallback、option 域外→TS、エラー文字列一致

### 単体テスト
- runtime の境界(count 一致限界・u32 境界・fallback ログ1回)

## 実装アプローチ
- **Outside-In**: 共通契約 suite を先に書き(3ハイブリッドに対して実行)、Red で runtime 新設
- 既存の3つの unavailable-path テスト suite は runtime suite に統合し、per-core wasm-success suite は保持する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: dedup 本番統合 PBI(未作成)の直前に完了していることが望ましい。他候補とは独立
- 遵守すべき ADR: ADR-017 の決定3(ハイブリッド統一)・5(インデックス再構築契約)
- 非機能要件: 出力 byte 等価。runtime への一般化で per-core ポリシー(fail-open vs exact parity)を潰さない

## 実装者向け注記

### 現状の証拠
- 儀式の逐語コピー: `src/background/pipeline/piiSanitizeHybrid.ts`(187行) / `src/utils/sentenceExtractorHybrid.ts`(136行) / `src/utils/contentDedupHybrid.ts`(178行) — `wasmAvailable` probe ~25行×3、`U32_MAX` ガード(同コメント)×3、catch→warn→addLog→TS fallback 末尾×3
- remap 慣習: `sentenceExtractorHybrid.ts:109-127` / `contentDedupHybrid.ts:146-169` — split 総数一致ゲート+範囲チェックが各 hybrid 内の ~10行
- PII エラー文字列の二重所有: `piiSanitizeHybrid.ts:105-116,161-170` が `piiSanitizer.ts` の上限メッセージを手動再現
- wrapper 層: `src/wasm/{pii-sanitizer,textrank,sentence-dedup}/index.ts` — `initExtensionWasm` 1行 + try/catch は薄く、対象外
- 手順漏れの実績: dedup は public コピー延期中で本番呼び出しは 404 になる(wxt.config.ts publicAssets の NOTE 参照)
