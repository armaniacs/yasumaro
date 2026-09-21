# PBI: Node 側 WASM ロード儀式を共有 test helper に集約する

種別: refactor

## ユーザーストーリー

メンテナーとして、Node 側の WASM ロード手順を共有 helper の呼び出し一回に集約したい、なぜなら現状はバイト読み込みと `initWasmModule({ module_or_path: bytes })` の同一手順が parity test と bench と `vi.mock` ブロックに約8箇所複製されており、ロード方法の変更が多箇所編集になるから

## 優先度

- 順位: 6
- RICEスコア: 16（Reach=4 / Impact=1 / Confidence=1.0 / Effort=0.25週）
- 根拠: 8重複の test/bench インフラ。production の振る舞いは変えず、変更耐性だけを上げる守備的な refactor のため Impact は 1 に抑える。Reach 4 は4クレート横断の test/bench 所有者が受益するため。Effort 0.25週は helper 追加と呼び出し置換のみのため

## ビジネス価値

WASM ロード方法の変更（バイナリ配置パス・glue の init API・CSP 回避策の更新）時の編集箇所が1箇所になる。Node 経路のロード知識に単一所有者を与え、複製間の微差による flaky な test/bench 故障を防ぐ。production コードの変更なしに開発速度だけを上げる

## BDD受け入れシナリオ

```gherkin
Scenario: parity test が helper 経由で初期化される
  Given 共有 helper `initWasmForNode` が存在する
  When 各 parity suite の `beforeAll` が helper 呼び出しのみで WASM を初期化する
  Then TS 対 WASM の等価性検証が従来通り全件パスする

Scenario: bench が helper 経由で初期化される
  Given 共有 helper が存在する
  When 各 `bench.ts` が helper 呼び出しのみで WASM を初期化する
  Then ベンチ計測対象の呼び出し経路と計測結果が従来と変わらない

Scenario: wasm-success test の vi.mock が factory に一本化される
  Given 共有 `vi.mock` factory が存在する
  When 各 `*.wasm-success.test.ts` が factory を使う
  Then WASM 成功経路の検証が従来通りパスし、mock 内の独自バイト読みが残らない
```

## 受け入れ基準

- [x] `src/wasm/testing/` 配下または同等の test-support 配置に `initWasmForNode(glueInit, wasmUrl)` 相当の helper が存在する
- [x] `vi.mock` 用の factory が1本化され、3つの `*.wasm-success.test.ts` が factory を使う
- [x] 約8箇所の複製 `initForNode` が helper 呼び出しに置換され、独自のバイト読みが残らない
- [x] production コード（`src/wasm/<crate>/index.ts`・`initWasm.ts`・glue）に変更がない
- [x] `npm run validate` が green である
- [x] 変更前後で parity・wasm-success の結果が同一である

## テスト戦略（t_wadaスタイル・test-only）

### E2Eテスト

- 対象外（test/bench インフラのみの変更。ユーザー可視の振る舞いは変えない）

### 統合テスト

- 既存 parity suite 全件を回帰ゲートとして使う（helper 置換前後で結果が同一であること）
- 既存 `*.wasm-success.test.ts` 3件を回帰ゲートとして使う（factory 置換前後で結果が同一であること）
- `npm run validate` を統合検証 green の判定に使う

### 単体テスト

- 追加の単体テストは書かない（本 PBI 自体が test helper の refactor であり、既存 test が仕様になる）
- helper の重複呼び出しが冪等であること（複数 suite からの連続初期化で例外にならないこと）を既存 suite の実行で確認する

## 実装アプローチ

- **test-only refactor**: production コードは変更しない。対象は `__tests__`・`bench.ts`・`bench/` 配下のみ
- **design-it-twice**: 配置は `src/wasm/testing/` を第一候補とし、同等の test-support 配置との2案を比較してから1案に決める。比較軸は import 深さ・Vitest 解決・bench（`tsx` 実行）からの解決可否
- **Red-Green-Refactor**: 既存 suite を Green として固定し、1箇所ずつ呼び出し置換して毎回 Green を確認する。一括置換はしない
- helper の signature は `initWasmForNode(glueInit, wasmUrl)` 相当とし、バイト読みと `module_or_path` 渡しを内部に閉じ込める。`vi.mock` factory はこの helper の薄いラッパーにする

## 見積もり

1pt（0.25週、要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。4クレート（`pii-sanitizer`・`sentence-dedup`・`textrank`・`tag-cooccur`）の test/bench に横断するが、production の初期化経路（`initExtensionWasm`・各 `index.ts`）には触れない
- CSP 制約: `new URL(..., import.meta.url)` パターンを helper 内で使う場合、Vite の静的 asset scan による `data:` URI インライン化（`initWasm.ts`・`postprocess-wasm-glue.mjs` の既知制約）を再発させないこと。既存の `fileURLToPath(new URL(...))` 形式を維持する
- テスタビリティ: helper 自体の検証は既存 parity・wasm-success suite のパスで代用する
- 非機能要件: bench の計測経路（production wrapper 経由の計測）を変えない。初期化だけを置換する
- 制約: failure scenario である「ロード方法変更時の約8箇所編集」を「helper 1箇所編集」にすること。呼び出し側にバイト読みを残さない

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
grep -rn "initForNode\|module_or_path: bytes" src/wasm bench | head -30
```

### 証拠

- `src/wasm/initWasm.ts:15-16` — `Node/tests bypass this module and feed the wasm bytes to the glue directly`。Node 経路に所有者がないことの自認。extension 経路の `initExtensionWasm` に対応する Node 側 helper が存在しない
- `src/wasm/pii-sanitizer/__tests__/parity.test.ts:27-32` — `initForNode` が `readFile` と `initWasmModule({ module_or_path: bytes })` を直書きする複製1
- `src/wasm/sentence-dedup/__tests__/parity.test.ts:48-52` — 同一 `initForNode` の複製2
- `src/wasm/tag-cooccur/bench.ts:37-40` — 同一 `initForNode` の複製3（bench 側）。`src/wasm/tag-cooccur/__tests__/parity.test.ts:96-100` に parity 側の対もある
- `src/wasm/pii-sanitizer/__tests__/extended-patterns-parity.test.ts:27-30` — 同一 `initForNode` の複製4
- `src/wasm/textrank/bench.ts:22-25` — 同一 `initForNode` の複製5。`src/wasm/pii-sanitizer/bench.ts:21-24` と `src/wasm/sentence-dedup/bench.ts:31-34` も同型
- `src/utils/__tests__/contentDedupHybrid.wasm-success.test.ts:17-30` — `vi.mock` ブロック内のバイト読みと `initWasmModule({ module_or_path: bytes })` の複製。他に `src/utils/__tests__/sentenceExtractorHybrid.wasm-success.test.ts:27` 付近、`src/background/pipeline/__tests__/piiSanitizeHybrid.wasm-success.test.ts:26` 付近、`src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts:29` 付近が同型

### 実装手順

1. 配置を design-it-twice で決める（`src/wasm/testing/` 候補と対案の比較）
2. `initWasmForNode(glueInit, wasmUrl)` 相当の helper を追加する
3. `vi.mock` 用 factory を helper の薄いラッパーとして追加する
4. parity test → bench → wasm-success test の順に1箇所ずつ置換し、都度対象 suite を実行する
5. `grep -rn "module_or_path: bytes" src/wasm src/utils src/background src/dashboard` で呼び出し側の直書きがゼロであることを確認する
6. `npm run validate` で統合検証 green を確認する

### 落とし穴

- production の `src/wasm/<crate>/index.ts` と `src/wasm/initWasm.ts` には触れないこと（test/bench のみが対象）
- bench（`npx tsx` 実行）と Vitest の両方から解決できる配置にすること。片方からしか解決できない配置は不可
- `postprocess-wasm-glue.mjs` の `module_or_path` 必須制約を崩さないこと。helper 内でも `module_or_path` 渡しを維持する

## Definition of Done

- [x] 全BDDシナリオが実装されパスする
- [x] コードレビュー完了
- [x] 統合検証 green（`npm run validate`）
