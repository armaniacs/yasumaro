# PBI: logger モック共通 factory への移行

## ユーザーストーリー

テストの保守者として、~160 テストファイルに手作りされている logger 3 層モックを testDir 配下の共通 factory に集約したい。モック定義がファイルごとに散在していると、logger の形状変更時に大量の重複修正が発生し、モック間の微妙な差異が flaky の発生源になるからだ。

## 優先度

- 種別: test
- 順位: 19 / 20
- RICEスコア: 2.4（Reach=8 / Impact=1 / Confidence=0.9 / Effort=3.0）
- 根拠: 効果は大きいが対象 ~160 ファイルと膨大。機械的置換のみで実施するため信頼性は高いが工数が重い。
- 依存: 特になし（ただし実行は専用 solo wave）。

## 背景

- logger 3 層（`logger/types.js` 158 ファイル、`core.js` 164 ファイル、`api.js` 172 ファイル）それぞれに対する個別 `vi.mock` ブロックが ~160 テストファイルに重複している。
- `ErrorCode` のリテラル `{INTERNAL_ERROR:'INT_001'}` が 112 箇所に重複（例: `src/popup/__tests__/tabSeamNullPin.test.ts:46-57`、`src/popup/__tests__/statusPanel-extra.test.ts:87-98`）。
- 修正方針: `testDir/mocks/logger.ts` に共通 factory を用意し、既存ファイルを同一モック意味論のまま機械的に移行する。

## 警告

- 本 PBI は ~160 ファイルに触る。並列タスクと同時実行すると競合が大量発生するため、**専用の solo wave で単独実行する**こと。
- 移行は機械的置換のみ。モックの意味論変更・アサーション変更は行わない。

## BDD受け入れシナリオ

```gherkin
Scenario: 共通 factory を使ってもモックの意味論が変わらない
  Given testDir/mocks/logger.ts に logger 3 層の factory が定義されている
  When 既存テストファイルを factory 利用に機械的に置き換える
  Then 各テストのアサーション結果が移行前と一致する
  And npm run validate が成功する

Scenario: ErrorCode リテラルの重複が factory に集約される
  Given ErrorCode {INTERNAL_ERROR:'INT_001'} が 112 箇所に重複している
  When 共通定義へ置き換える
  Then テスト内のリテラル重複が消える
  And テスト結果に変化がない
```

## 受け入れ基準

- [x] `testDir/mocks/logger.ts` に logger types/core/api 3 層の factory が実装されている。
- [x] 移行対象 ~160 ファイルが factory 利用に置き換わり、個別 `vi.mock` ブロックの重複が消えている。
- [ ] ErrorCode リテラル 112 箇所が共通定義へ置き換わっている。
- [x] 全移行が同一モック意味論の機械的置換であり、意味変更を含まない。
- [x] 移行は専用 solo wave で単独実行され、並列タスクとの競合がない。
- [x] `npm run validate` が成功している。
- [x] テスト件数・結果が移行前と一致している。

## テスト戦略

### 単体テスト

- 移行前後で全テストの実行結果（件数・成功/失敗）を diff し、同一であることを確認する。
- factory 自体に対して、logger 3 層の形状を pin する検証を `testDir` 内に置く。

### 統合テスト

- `npm run validate` をゲートとし、段階バッチ（例: popup → dashboard → background）ごとに検証してから次へ進む。

## 見積もり

**3.0 SP**

~160 ファイルの機械的置換。工数は置換スクリプトの整備と段階検証が中心。

## Definition of Done

- [x] testDir/mocks/logger.ts が実装されている。
- [x] 対象ファイルの個別 vi.mock 重複が消えている。
- [ ] ErrorCode リテラル重複が消えている。
- [x] solo wave での単独実行が守られている。
- [x] `npm run validate` が成功している。
- [x] テスト件数・結果の移行前後一致を確認している。

## 実装記録（2026-10-03 統合）

### factory 形状

- `testDir/mocks/logger.ts`: `createLoggerModuleMock(spec)` 1 関数。spec エントリは 4 種の log-fn モックスタイル（`fn` / `resolved` / `asyncNoop` / `resolvedUndefined`）、名前付き LogType 変種（`LOG_TYPE_MOCKS` 8 種）、名前付き ErrorCode 変種（`ERROR_CODE_MOCKS` 17 種）、インライン record リテラル、呼び出し側提供値の verbatim パス（vi.hoisted spy 等）に対応。
- `vi.mock` factory は hoisting のため静的 import 参照が不可避に不可なので、factory 本体から `testDir/mocks/logger.js` を dynamic import する形に統一。毎呼び出しで新規 `vi.fn()` を生成し、置換前の手作りブロックと同一のモック意味論を保持。

### 移行件数

- 移行テストファイル 167 + 新規 factory pin テスト `testDir/__tests__/loggerMockFactory.test.ts`（8 tests）= 変更セット計 168 テストファイル + `testDir/mocks/logger.ts` 新規。
- 全 167 ファイルで手作りモックブロック本体（`vi.fn` 構築・オブジェクト組み立て）が消滅し `createLoggerModuleMock` 呼び出しに置換。

### 構文破壊の修復

- 移行作業中に 476 箇所の `vi.mock` factory 呼び出し終端が `););` に破壊（167 ファイル全件）。tsc は `src/**/__tests__` と testDir を除外するため検出できず、vitest parse が全 167 ファイルで失敗する状態だった。
- 修復: `sed 's/^););$/);/'` を 167 ファイルへ機械適用。改行コード維持（全 LF、CR 含有 50 src ファイルと零重複）。修復判定: SOUND — spy スタイル 1:1、呼び出し側 spy の verbatim パス、独自 ErrorCode リテラル保持をサンプル diff で確認。

### 検証

- 段階バッチ検証（修復エージェント）: background/popup/dashboard/utils/content/offscreen/messaging の 26 移行ファイル 823 tests green + factory pin 8 tests green。
- フルゲート（統合側実測）: `npx tsc --noEmit` 0 errors / `npm run lint` 0 errors（119 warnings は既存 no-greedy-fake-timers 等、新規 0）/ `npm test` 1022 files passed | 1 skipped・15602 tests passed | 21 skipped / `npm run validate` exit 0。
- `type-check:test` 469 errors、HEAD 実測（NN34 適用前、worktree スナップショット）469 と同数。位置正規化（file: error TSxxxx 単位）でエラー集合完全一致 — NN34 による型エラー増減 0。pin 474 以下（delta 0）で baseline ゲート通過。
- テスト件数の移行前後一致: HEAD 実測 15609（15571 passed + 38 skipped）に対しツリー 15623（15602 + 21）。差分 +14 の内訳: NN34 分 +8（loggerMockFactory pin、テスト戦略どおり testDir 内に新設）、残り +6 は worktree アーティファクト（gitignored `src/utils/crypto/__tests__/tmp/verify-new.test.ts` 3 tests、untracked `.kilorules` 由来の `agent-poll-interval.test.ts` +3）で NN34 非帰属。skip 差 −17 は dist/ 非存在の worktree で wxt-build/manifest テストが skip になる環境差。移行対象 167 ファイルのテスト件数・結果は移行前後で一致（0 removed / 0 changed / 全 green）。

### 未達（残置）

- ErrorCode リテラルの重複除去: factory への置換後もリテラル値（`{ INTERNAL_ERROR: 'INT_001' }` 等）は spec エントリとしてインライン維持（115 箇所 / 42 ファイル、`ErrorCode: {…}` 290 箇所全てインライン、名前付き変種利用 0）。機械的置換で意味論 1:1 を保つため名前付き変種（`internalUnknown` 等）への書き換えは行わず、行為としては「モック構造の重複は factory に集約済み・リテラル値の重複は残存」。後続候補: 名前付き変種への機械書き換え（要フルゲート再検証）。
