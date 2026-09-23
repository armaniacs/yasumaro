# PBI 2026-09-23-04 — ハイブリッド足場の汎用化（runHybrid 深い interface）

**優先度**: 順位 4 / RICE 8.0（Reach 5 × Impact 1 × Confidence 80% ÷ Effort 0.5 人週）
**根拠**: runtime が機構（probe・fallback・remap・数値境界）を所有した後も、4 ハイブリッドに約 40–60 行の同型骨格がミラーされ、5 個目の WASM コア追加が 4 ファイル目のコピペになる。骨格重複 150–200 行を政策データ行に畳める。
**種別**: refactor（非機能追加）

## 背景

`wasmHybridRuntime.ts`（177 行）が `createHybridProbe` / `withWasmFallback` / `remapWasmIndices` / `isWasmSafeU32` / `isWasmSafeF64` を正しく所有した後も、`piiSanitizeHybrid.ts`（176）・`sentenceExtractorHybrid.ts`（99）・`contentDedupHybrid.ts`（136）・`tagCooccurrenceHybrid.ts`（112）に「defaults merge → early-return → `probe.isAvailable()` → `withWasmFallback` → split 検証 → join 整形」の同型骨格が 4 回ミラーされている。`isWasmSafeOptions` は 4 実装に分かれる（TextRank は `topK>=1` quirk、dedup は threshold+minLength、PII はサイズ政策、tag-cooccur は limit のみ）。

## 実装戦略

1. `wasmHybridRuntime.ts` に汎用 `runHybrid({ probe, mergeDefaults, earlyReturn, isSafe, callWasm, callTs, remap })` を追加する。機構（probe 契約・burst ログ・remap gate・fallback 順序）は runtime に固定する。
2. 4 ハイブリッドを政策データ＋`callWasm`/`callTs` の 2 関数のみの Adapter 行に畳む。政策（defaults・early-return 条件・MIN_* しきい値・split/join 整形）は各 Adapter の宣言データとして保持する。
3. parity 戦略（ADR 2026-09-20-wasm-exact-port-parity-strategy）・フォールバック語義（PII の fail-closed）・しきい値の値は一切変更しない。既存の e2e が console.warn 文言に依存する箇所は文言を変えない。

## 受け入れ基準（BDD）

### シナリオ 1: 骨格の重複が消える
- **Given** 4 ハイブリッドのdefaults merge → early-return → probe → fallback の流れ
- **When** `runHybrid` 導入後に各ファイルを走査する
- **Then** 同型骨格が runtime 1 箇所のみとなり、各ハイブリッドは政策行＋2 関数の Adapter になる

### シナリオ 2: フォールバック語義は不変
- **Given** WASM 初期化不可・引数域外・実行時エラーの入力
- **When** `runHybrid` 経由で各コアを実行する
- **Then** 現行と同一の TS リファレンス フォールバック結果・ログ文言・fail-closed 挙動になる（既存テスト緑のまま）

### シナリオ 3: 5 個目のコアは政策行のみで追加できる
- **Given** 新しい WASM コアの追加タスク
- **When** 政策データ（defaults・earlyReturn・isSafe・callWasm・callTs）を宣言する
- **Then** 骨格の実装・テストは runtime 契約テストで足りる

## DoD（Definition of Done）

- [ ] `runHybrid` が runtime の公開 interface になり、4 ハイブリッドの骨格重複が消える（実測行数を記録）
- [ ] 既存の parity / probe-retry / wasm-success テストが無修正で緑
- [ ] wasm/crates.json・ADR 2026-09-20 に触れない
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
