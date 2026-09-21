
> 主張訂正（2026-09-21）: 上記の「c8 前例 ヒープ 17MB→0.18MB」は `bench/wasm-memory-probe.ts`（gc 強制後のフットプリント計測、Node --expose-gc）では再現しなかった。実測は 10k×20 で 1 呼び出しあたり **TS 7.17MB → WASM 4.58MB（−36%）**。per-record `Set<string>`（≈5MB）と `edgeWeights` Map の排除が主因だが、`joinRawTags` の入力文字列（≈2.8MB）と decode のエッジオブジェクト（≈1.5MB）は JS ヒープに残る。速度面（5.53x）と併せて総合判断は不変。
