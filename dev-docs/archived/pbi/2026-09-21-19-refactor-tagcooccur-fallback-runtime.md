# PBI: tagCooccur hybrid の fallback+guard を wasmHybridRuntime 契約に統一する

種別: refactor

## ユーザーストーリー

WASM hybrid を保守する開発者として、`tagCooccurrenceHybrid` の手書き fallback と u32 境界 guard を `wasmHybridRuntime` の共有契約に統一してほしい。なぜなら同一形状の fallback が2箇所に手書きで残り、u32 上限の判定が wrapper と hybrid に分散しているため、片側だけ修正されると他の3 hybrid と出力ログや振る舞いが乖離する drift が起きるから。

## 優先度

- 順位: 3
- RICEスコア: 24 (Reach 6 / Impact 1 / Confidence 1.0 / Effort 0.25週)
- 根拠: runtime 契約の劣化防止。現時点で障害は出ていないが、fallback ログと u32 境界の所有が分散したままでは将来の修正が3 hybrid と tagCooccur で別々に drift するため、先に契約へ寄せる必要がある。

## ビジネス価値

fallback ログと数値境界の所有が runtime 契約に一本化され、ログ文言の修正や境界値の変更が全 hybrid に一括で反映される。tagCooccur だけが独自実装を持つ状態が解消されるため、回帰調査とレビューのコストが削減される。

## BDD受け入れシナリオ

```gherkin
Scenario: WASM 呼び出し失敗時は runtime 経由で TS にフォールバックする
  Given computeTagCooccurrenceHybrid と narrowEntriesToTopTagsHybrid が withWasmFallback 経由で WASM を呼び出す
  When WASM 呼び出しが任意の例外を送出する
  Then runtime 標準フォーマットの warn と addLog が1回ずつ記録される
  And TS 実装の再実行結果が返される

Scenario: u32 範囲外の limit は WASM を呼ばず TS に bypass する
  Given narrowEntriesToTopTagsHybrid の bypass 判定が isWasmSafeU32 に統一されている
  When limit に非整数・負数・2^32 以上の値を渡す
  Then WASM 初期化も WASM 呼び出しも行われず TS 実装の結果が返される

Scenario: fallback メッセージ文言は runtime 標準と byte 等価である
  Given 両 entry point の fallback メッセージが runtime 標準フォーマットに統一されている
  When WASM 呼び出し失敗時のログ出力を取得する
  Then メッセージ文言が golden pin と byte 等価である
```

## 受け入れ基準

- [x] `computeTagCooccurrenceHybrid` の手書き try/catch が `withWasmFallback` への委譲に置き換わっている
- [x] `narrowEntriesToTopTagsHybrid` の手書き try/catch が `withWasmFallback` への委譲に置き換わっている
- [x] `limit > 0xffffffff` の上限チェックが wrapper から hybrid 側の bypass (`isWasmSafeU32`) へ移動し wrapper が薄くなっている
- [x] fallback メッセージ文言が runtime 標準フォーマットと byte 等価であることが golden pin で保証される
- [x] `tagCooccurrenceHybrid.probe-retry.test.ts` が無変更で green である
- [x] 既存の parity テストが全件 green のままである

## テスト戦略（t_wadaスタイル・byte等価）

Outside-In で進める。まず現行2箇所の fallback ログ出力を固定する golden pin と、u32 境界値 (0・2^32-1・2^32・負数・非整数) の bypass/bypass しない振る舞いを固定する境界テストを先に書く (Red)。次に両 entry point を `withWasmFallback` 経由に置き換え、`isWasmSafeU32` による bypass へ移動した後に golden と境界テストが全件 Green のままであることを確認する (Refactor)。単体では WASM 成功時・WASM 送出時・TS フォールバック送出時 (fail-closed 伝播) の3分岐を検証し、統合では既存 probe-retry テストの無変更 green で代替する。E2E は対象外とする。

## 実装アプローチ

1. 現行2箇所の fallback ログ出力を golden pin として固定し、u32 境界の現行振る舞いを境界テストとして固定する
2. `computeTagCooccurrenceHybrid` と `narrowEntriesToTopTagsHybrid` の手書き try/catch を `withWasmFallback` への委譲に置き換える
3. `limit > 0xffffffff` の上限チェックを hybrid 側の bypass (`isWasmSafeU32` の import) へ移動し、`narrowEntriesToTopTagsWithWasm` 側の重複判定を薄くする
4. fallback メッセージ文言を runtime 標準フォーマットに統一し、golden pin で byte 等価を確認する
5. 既存 probe-retry テストと parity テストを無変更で green であることを確認する

## 見積もり

1pt (0.25週)

## 技術的考慮事項

- `withWasmFallback` は WASM 側の任意の送出を TS 再実行で吸収するが、TS フォールバック自体の送出は伝播させる (fail-closed)。tagCooccur の呼び出し側もこの契約に従う
- `isWasmSafeU32` は [0, 2^32-1] の整数のみを通す。policy は hybrid 側が所有し、mechanism 層 (wrapper) は判定を持たない配置にする
- fallback メッセージ文言は表示とログ検索の対象であり、1文字の差異も回帰になるため byte 等価を維持する
- probe 契約 (成功 cache・失敗再 probe・burst guard) は `createHybridProbe` 側に残し、この PBI では変更しない

## 実装者向け注記

- `src/dashboard/tagCooccurrenceHybrid.ts:84-90` に compute 側の手書き fallback がある。`console.warn` + `addLog` + TS 再実行の形状は `src/utils/wasmHybridRuntime.ts:115-138` の `logWasmFallback` / `withWasmFallback` と同一であり、置き換え対象である
- `src/dashboard/tagCooccurrenceHybrid.ts:112-118` に narrow 側の手書き fallback がある。同上でもう1箇所の重複であり、両 entry point を `withWasmFallback` 経由に統一する
- `src/utils/wasmHybridRuntime.ts:45-47` の `isWasmSafeU32` が runtime 側の標準境界判定である。hybrid 側はこれを import して bypass に使う
- runtime 側の採用実績は `src/background/pipeline/piiSanitizeHybrid.ts:107`、`src/utils/sentenceExtractorHybrid.ts:86`、`src/utils/contentDedupHybrid.ts:117` の3箇所であり、いずれも `withWasmFallback` への委譲形状である
- `src/wasm/tag-cooccur/index.ts:181` に wrapper 内の `limit > 0xffffffff` の throw がある。mechanism 層に policy が入り込んだ配置であり、hybrid 側の bypass へ移動して wrapper を薄くする
- `src/dashboard/tagCooccurrenceHybrid.ts:104` の bypass は `!Number.isInteger || limit < 0` のみであり、u32 上限を含まない。上限判定が wrapper と hybrid に分散している drift の現物である
- 故障シナリオ: fallback ログの修正が3 hybrid と tagCooccur で別実装になり drift する。u32 境界の policy が wrapper と hybrid に分散しているため、境界値変更時に片側の修正漏れが起きる

## Definition of Done

- [x] 全BDDシナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
