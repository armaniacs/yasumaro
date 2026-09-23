# PBI 2026-09-23-09 — ExtractionReport Module（抽出診断 18 フィールド幅の圧縮）

**優先度**: 順位 9 / RICE 8.0（Reach 5 × Impact 2 × Confidence 80% ÷ Effort 1.0 人週）
**根拠**: `ExtractResult` の約 18 mostly-optional 診断を全消費者が知らなければならない。report 背後化で index.ts 580→約460 行、kernel の 22 行手コピーを 1 呼び出しに。byte 列改名が report＋1 mapper のみに。
**種別**: refactor（非機能追加）

## 背景

`contentExtractor/types.ts:39-70` の `ExtractResult` は約 18 の診断フィールドを運ぶ。`index.ts` は `withDiagnostics` 真偽値を `extractInternal`（:111-117）に通し、`ByteMeter`（:123）を組み立て、2 つの歴史的非対称 flag（`dualPayloadFirst`、`emitSanitizeLog`、:221-230,348-355）を保持し、main path 後に recount（:519-553）＋funnel（:505-507）＋body-fallback（:509-515）を連ねる。`contentKernel.applyExtractResultToPageState` は約 10 field を手コピー（:211-233）、sqlite schema は 8 byte 列を鏡写し（schema.ts:34-43）、whitelist early-return（:394-413）は診断を bypass するため呼び出し側は存在を仮定できない。

## 実装戦略

1. 公開 interface を `extract(config) → { content, report }` にし、report は `bytesFunnel()` / `cleanseCounts()` / `fallbackCause()` / `originalText()` の狭い Seam のみで触れる形にする。
2. `ByteMeter`・dual-payload 保持（`maxChars*2` 政策）・funnel・recount を Module 背後に移す。`withDiagnostics` 真偽値と非対称 flag を削除し、whitelist path も `report`（`adapterUsed`＋空 byte-funnel）を返す形に統一する。
3. kernel は `applyReport(report)` の 1 呼び出しにする。
4. bench（micro/c1,c4）の非診断 path はバイト同一を維持する。WASM parity への波及はなし（content path のみ）。

## 受け入れ基準（BDD）

### シナリオ 1: ホット path は診断バイトを含まない
- **Given** 通常の抽出入力
- **When** 非診断 path を実行する
- **Then** 出力文字列が現行とバイト同一であり、診断計測の副作用がない（bench 回帰で確認）

### シナリオ 2: whitelist path も report を返す
- **Given** whitelist early-return に該当する入力
- **When** `extract(config)` を呼ぶ
- **Then** `adapterUsed` を持つ report が返り、呼び出し側は field 存在を仮定しなくてよい

### シナリオ 3: 列改名の影響範囲は 2 箇所に限定される
- **Given** byte 系診断列の改名タスク
- **When** 影響ファイルを数える
- **Then** report Module と 1 mapper のみであり、extractor/kernel/schema/tests への波及がない

## DoD（Definition of Done）

- [ ] `extract(config) → { content, report }` が公開 interface になり、`withDiagnostics` と非対称 flag が消える
- [ ] kernel の手コピーが `applyReport(report)` 1 呼び出しになる
- [ ] 診断政策が約 8 report レベルテストに pin される
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
