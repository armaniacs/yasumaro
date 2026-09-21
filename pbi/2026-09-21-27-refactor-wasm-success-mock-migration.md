# PBI: 残り2つの wasm-success mock を createNodeWasmInit に移行し Node ローダの単一所有を完成させる

種別: refactor

## ユーザーストーリー

メンテナーとして、残り2つの `*.wasm-success.test.ts` の `vi.mock` ブロックを `createNodeWasmInit` による初期化に移行したい、なぜなら現状は `fileURLToPath` とローカル `initPromise` メモと `readFile` から `initWasmModule({ module_or_path })` を呼ぶ13行の手書き儀式が2箇所に残っており、glue 署名やメモ意味論の変更が個別適用になって `initWasmForNode` の deletion test が PARTIAL のままだから

## 優先度

- 順位: 2
- RICEスコア: 16（Reach=4 / Impact=1 / Confidence=1.0 / Effort=0.25週）
- 根拠: PBI-22 の宣言済み残サイトの掃除であり、新規範囲の発見ではない。Reach 4 は4クレート横断の test 所有者が受益するため。Impact 1 は production の振る舞いを変えない守備的な refactor のため。Effort 0.25週は創型テンプレートへの機械移行2件と陳腐 doc 2行修正のみのため

## ビジネス価値

Node 経路の WASM ロード知識の単一所有者が完成する。glue 署名やメモ意味論の変更時の編集箇所が `src/wasm/testing/initWasmForNode.ts` の1箇所になり、残り2箇所への個別適用漏れと微差による flaky な test 故障を防ぐ。production コードの変更なしに開発速度だけを上げる

## BDD受け入れシナリオ

```gherkin
Scenario: 残り2つの wasm-success mock が factory 経由で初期化される
  Given 共有 factory `createNodeWasmInit` が存在する
  When `piiSanitizeHybrid.wasm-success.test.ts` と `tagCooccurrenceHybrid.wasm-success.test.ts` の `vi.mock` が factory 呼び出しのみで WASM を初期化する
  Then WASM 成功経路の検証が従来通りパスし、mock 内の独自バイト読みが残らない

Scenario: glue 署名の変更が単一箇所の編集で済む
  Given 2つの mock が factory に一本化されている
  When glue の init 形状やメモ意味論が変わる
  Then `initWasmForNode` の修正だけで両 suite が追随し、個別適用が不要になる

Scenario: 陳腐 doc 2行が委譲後の実態と一致する
  Given `tag-cooccur` と `js-strings` の doc が委譲前の記述のままである
  When 同一 PBI で該当2行を更新する
  Then doc が共有クレートへの委譲を正しく説明する
```

## 受け入れ基準

- [ ] `src/background/pipeline/__tests__/piiSanitizeHybrid.wasm-success.test.ts` が `createNodeWasmInit` を使い、独自の `fileURLToPath` と `readFile` と `initPromise` メモを持たない
- [ ] `src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts` が `createNodeWasmInit` を使い、独自の `fileURLToPath` と `readFile` と `initPromise` メモを持たない
- [ ] 両 mock の `return` 形状が移行前と同一である（`sanitizePii` 直接 import 維持、`vi.importActual` spread 維持）
- [ ] `grep -rn "module_or_path: bytes" src/background src/dashboard` で呼び出し側の直書きがゼロである
- [ ] `wasm/tag-cooccur/src/cooccur.rs` の陳腐 doc 1行と `wasm/js-strings/src/jsstring.rs` の陳腐 doc 1行が委譲後の実態に更新される
- [ ] production コード（`src/wasm/<crate>/index.ts`・`initWasm.ts`・glue）に変更がない
- [ ] `npm run validate` が green である

## テスト戦略（t_wadaスタイル・test-only）

### E2Eテスト

- 対象外（test インフラのみの変更。ユーザー可視の振る舞いは変えない）

### 統合テスト

- 既存 `piiSanitizeHybrid.wasm-success.test.ts` を回帰ゲートとして使う（移行前後で結果が同一であること）
- 既存 `tagCooccurrenceHybrid.wasm-success.test.ts` を回帰ゲートとして使う（移行前後で結果が同一であること）
- `npm run validate` を統合検証 green の判定に使う

### 単体テスト

- 追加の単体テストは書かない（本 PBI 自体が test helper への refactor であり、既存 test が仕様になる）
- factory のメモ意味論（同時呼び出しが同一 `initPromise` を共有すること）を既存 suite の実行で確認する

## 実装アプローチ

- **test-only refactor**: production コードは変更しない。対象は残り2つの `*.wasm-success.test.ts` のみ
- **創型テンプレートへの機械移行**: `src/utils/__tests__/contentDedupHybrid.wasm-success.test.ts` の6行形式（`createNodeWasmInit(initWasmModule, new URL(...))`）を正として2箇所を置換する。`return` 形状は維持し挙動不変とする
- **Red-Green-Refactor**: 既存 suite を Green として固定し、1ファイルずつ置換して毎回対象 suite を実行する。一括置換はしない
- **drive-by doc 修正**: `wasm/tag-cooccur/src/cooccur.rs` の1行と `wasm/js-strings/src/jsstring.rs` の1行を同一 PBI で委譲後の記述に更新する

## 見積もり

1pt（0.25週、要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。PBI-22 で所有者が `src/wasm/testing/initWasmForNode.ts` に確立済みであり、本 PBI は残サイトの置換のみ
- CSP 制約: 呼び出し側の `new URL('...wasm', import.meta.url)` 形式を維持し、helper 側に `.wasm` 名を書かない制約（Vite の静的 asset scan による `data:` URI インライン化の回避）を崩さないこと
- テスタビリティ: helper 自体の検証は既存 wasm-success suite のパスで代用する
- 非機能要件: hybrid の呼び出し経路（production wrapper 経由の計測対象）を変えない。初期化だけを置換する
- 制約: failure scenario である「glue 署名やメモ意味論の変更が残り2箇所へ個別適用になる」を「`initWasmForNode` の1箇所編集」にすること。`initWasmForNode` の deletion test が PARTIAL のまま残らないこと

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
grep -rn "module_or_path: bytes" src/background src/dashboard src/utils src/wasm/testing
```

### 証拠

- `src/background/pipeline/__tests__/piiSanitizeHybrid.wasm-success.test.ts:18-30` — `fileURLToPath` とローカル `initPromise` メモと `readFile` から `initWasmModule({ module_or_path })` を呼ぶ13行手書き。`sanitizePii` を glue から直接 import（`vi.importActual` ではなく）しており、移行後も `return` 形状は維持すること
- `src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts:21-33` — 同一形状の残サイト。`vi.importActual` spread で `initTagCooccurWasm` だけを上書きしており、移行後も `return` 形状は維持すること
- `src/utils/__tests__/contentDedupHybrid.wasm-success.test.ts:15-20` — 移行済み創型。`createNodeWasmInit(initWasmModule, new URL(...))` の6行に集約済み。2ファイルの置換はこの形式をテンプレートにすること
- `src/wasm/testing/initWasmForNode.ts:47-58` — メモ factory の所有者。`createNodeWasmInit` が singleton 意味論を閉じ込めており、呼び出し側に `initPromise` を残さないこと
- `wasm/tag-cooccur/src/cooccur.rs:18-19` — `The predicate below spells out` の記述が共有クレートへの委譲前前提のまま。委譲に更新すること
- `wasm/js-strings/src/jsstring.rs:1-2` — `shared by the textrank and sentence-dedup WASM cores` の記述が `tag-cooccur` と `pii-sanitizer` の追加前前提のまま。委譲先一覧に追加すること

### 実装手順

1. `src/background/pipeline/__tests__/piiSanitizeHybrid.wasm-success.test.ts:18-30` を創型テンプレートに置換し、`return` 形状（`initPiiSanitizerWasm` と `sanitizePiiWithWasm`）が同一であることを確認して対象 suite を実行する
2. `src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts:21-33` を創型テンプレートに置換し、`return` 形状（`...actual` spread と `initTagCooccurWasm` 上書き）が同一であることを確認して対象 suite を実行する
3. `grep -rn "module_or_path: bytes" src/background src/dashboard` で呼び出し側の直書きがゼロであることを確認する
4. `wasm/tag-cooccur/src/cooccur.rs:18-19` と `wasm/js-strings/src/jsstring.rs:1-2` の陳腐 doc 2行を更新する
5. `npm run validate` で統合検証 green を確認する

### 落とし穴

- 両 mock の `return` 形状を変えないこと（片方は glue 直接 import、片方は `vi.importActual` spread）。初期化だけを置換し、hybrid 側の解決経路を変えないこと
- production の `src/wasm/<crate>/index.ts` と `src/wasm/initWasm.ts` には触れないこと（test のみが対象。doc 2行の drive-by を除く）
- helper 側に `.wasm` ファイル名を書かないこと（`postprocess-wasm-glue.mjs` の既知制約）。`new URL('...wasm', import.meta.url)` は呼び出し側に残すこと

## Definition of Done

- [ ] 全BDDシナリオが実装されパスする
- [ ] コードレビュー完了
- [ ] 統合検証 green（`npm run validate`）
