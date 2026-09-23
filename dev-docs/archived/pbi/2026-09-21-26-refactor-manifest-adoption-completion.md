# PBI: wasm manifest の採用を完了させ、crate 列挙を crates.json に単一所有させる

種別: refactor

## ユーザーストーリー

メンテナーとして、wasm crate の列挙を `wasm/crates.json` の単一所有にしたい、なぜなら manifest 自身が `no other enumeration file may list crates` を宣言しているにもかかわらず、現在は `test:wasm`・CI cache path・CI step 名・CI parity 呼び出し・wxt CSP コメント・CONTEXT.md が別々に crate を列挙し、invariant が偽になっているから

## 優先度

- 順位: 1
- RICEスコア: **32**（Reach=8 / Impact=2 / Confidence=1.0 / Effort=0.5週）
- 根拠: manifest 自身の invariant が現在偽。`wasm/crates.json:3` の comment が `no other enumeration file may list crates` を宣言しているが、`package.json:13` の 5 ディレクトリ chain をはじめ CI・wxt・CONTEXT.md に重複列挙が残存し、crate 宇宙の答えが manifest に一本化されていない。PBI 2026-09-21-18 の集約は build:wasm・postprocess・publicAssets・CI gate 本体には到達したが、採用の周縁が残った状態である

## ビジネス価値

crate 追加・STAGED 昇格・lib-only crate の扱い変更が manifest の編集だけで完結し、5 箇所以上の同調編集コストと列挙漏れによる CI 誤検知・テスト未実行・ドキュメント陳腐化を防ぐ。測定方法: `js-strings` を含む crate 宇宙への問い合わせが `wasm/crates.json` の読み取り 1 回で答えられ、`grep -rn` による列挙の目視突き合わせが不要になること

## BDD受け入れシナリオ

```gherkin
Scenario: test 対象ディレクトリは manifest 由来である
  Given wasm/crates.json が build 対象 crate と lib-only の js-strings を区別して所有している
  When npm run test:wasm を実行する
  Then js-strings を含む全テスト対象が manifest 由来の列挙で実行され、package.json にディレクトリ名の直書き chain が残らない

Scenario: CI の cache と parity 呼び出しは manifest 駆動である
  Given wasm/crates.json が crate 一覧と parity suite の mapping を所有している
  When CI の wasm-test job が実行される
  Then cache path の 5 クレート列挙と 7-path parity vitest 呼び出し 2 行が manifest 由来の単一呼び出しに置き換わり、fresh rebuild と committed binary の両 parity が従来通り実行される

Scenario: prose の STAGED 記述が manifest と矛盾しない
  Given sentence-dedup が publicShip=false として manifest に登録されている
  When wxt.config.ts の CSP コメントと CONTEXT.md の WASM コア行を読む
  Then STAGED・出荷可否・crate 一覧の prose が manifest の field と一致し、manifest 駆動 loop と矛盾する記述が残らない
```

## 受け入れ基準

- [x] `npm run test:wasm` が 5 ディレクトリ名の shell chain 直書きではなく manifest を読む形で全テスト対象を実行する（`js-strings` の lib-only 扱いを含む）
- [x] CI cache path の 5 クレート列挙が manifest 駆動になる（workflow で loop できない場合は loader script のサブコマンド化）。lock キーの `hashFiles('wasm/*/Cargo.lock')` の汎用性と cache の意味論は維持する
- [x] CI の文字相同 7-path parity vitest 呼び出し 2 行が manifest の testDirs mapping と小さな helper による 1 本化で置き換わり、fresh / committed の両実行の意味論が変わらない
- [x] `wxt.config.ts` の CSP コメントの sentence-dedup STAGED prose が manifest 駆動 loop と矛盾しない形に更新される
- [x] `CONTEXT.md` の WASM コア行が tag-cooccur と js-strings の欠落なく crate 宇宙と一致する
- [x] `wxt.config.ts:216` の grep 検索パターン文字列は列挙ではなく benign として対象外であることが PBI・コードのいずれかで明記される
- [x] `npm run validate` が green であり、`validate:json` が `wasm/crates.json` を通る

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（列挙の一本化のリファクタリング。拡張機能の動作自体は変えない）

### 統合テスト

- manifest にテスト用 crate を 1 件追加した試行で、`test:wasm`・CI cache 解決・parity helper の全てに反映される（red-green: manifest 追加前は対象外、追加後は対象になる）
- `js-strings` の分類を変える試行（lib-only と build 対象の往復）で、`test:wasm` の対象有無だけが変わり、`build:wasm`・publicAssets・cmp ゲートの意味論が変わらない
- 一本化前後で `npm run test:wasm` の実行対象集合が等価であり、CI parity の fresh / committed 両実行の対象パス集合が等価である

### 単体テスト

- manifest ローダーの単体テスト: `js-strings` の分類 field・testDirs mapping の欠落・未知 field・パス解決失敗時に明示エラーで失敗する
- parity helper の単体テスト: manifest の testDirs mapping から fresh 用と committed 用の同一引数列を生成する（2 行の同期強制が不要になる）
- CI cache 解決の単体テスト: manifest から導出した target path 列が従来の 5 path 列挙と集合等価である

## 実装アプローチ

- **Outside-In**: crate 宇宙への問い `どの crate が存在し、どれを test し、どれの parity を走らせるか` の期待結果から定義し、読み手側（`test:wasm`・CI cache・CI parity・prose）を順に manifest 駆動へ寄せる
- **Red-Green-Refactor**: まず manifest 側に `js-strings` の分類と testDirs mapping を足す（green: 実行対象集合が等価）。その後に shell chain・CI 直書き列挙・prose を消す
- **リファクタリング**: グリーンになるたびに重複列挙を 1 つずつ消し、各段階で test 対象集合と parity 引数列の等価を再確認する

## 見積もり

2pt（0.5週、要チームでの見積もり）

## 技術的考慮事項

- 依存関係: PBI 2026-09-21-18 の `wasm/crates.json`・`scripts/wasm-crates.mjs`・`scripts/build-wasm.mjs` に依存する。新規 crate 追加の挙動は変えない
- 設計点は本 PBI 内で design-it-twice して記録する（下記）。`js-strings` はビルド対象外 lib であり、build・postprocess・publicAssets・cmp ゲートの対象ではないが、`test:wasm` と crate 宇宙の列挙対象ではある。この非対称を manifest でどう表現するかが核心である
- design-it-twice 案 A: 第二配列（例: `libCrates`・`testDirs`）を足す。build 用 `crates` 配列には触らず、test・CI 解決だけが第二配列を読む。変更範囲が小さく、既存 loader の赤・緑条件に影響しない。欠点は crate 宇宙が 2 配列に割れ、`no other enumeration` の読み替えが `2 配列の合併が宇宙` になることである
- design-it-twice 案 B: crate エントリに `kind` field（例: `build`・`lib`）を足す。宇宙は `crates` 配列 1 つに保たれ、各 consumer が `kind` で filter する。欠点は既存 4 エントリ全てへの field 追加と loader・consumer の filter 分岐が必要なことである
- 採用判断は実装者が上記の trade-off を比較して PBI に追記し、選択肢の却下理由を残すこと。いずれの案でも `js-strings` が manifest 外にのみ存在する状態を解消し、crate 宇宙の問いに manifest 1 回読みで答えられることを条件とする
- testDirs mapping（crate から TS parity suite dirs への対応）は manifest に足し、小さな helper で CI の 2 行を 1 本化する。fresh / committed の両実行という red-green 意味論は維持し、引数列の生成元だけを manifest に寄せる
- prose 更新は本 PBI に同梱する: wxt CSP コメント・CONTEXT.md。drive-by として `cooccur.rs:18-19` と `jsstring.rs:1-2` の陳腐 doc 2 行を更新する
- `wxt.config.ts:216` の grep 検索パターン文字列は列挙ではなく benign であり、本 PBI の対象外として明記する（将来の grep 拡張時の混乱を避けるため）
- CI cache path の manifest 駆動化では意味論を維持する（registry・git・wasm-pack binary の path と key の `hashFiles('wasm/*/Cargo.lock')` は変えない。target path 列の導出元だけを変える）
- 非機能要件: テスト実行時間の増加なし（列挙方法の変更のみ）。manifest の読み方は既存 loader（`scripts/wasm-crates.mjs`）の流儀に従い、新規の実行系を増やさない
- 制約: STAGED の prose（wxt CSP コメント内）は field 移行後に二重管理にしない。`validate:json` が `wasm/crates.json` を通るか確認し、通らない場合は対象に加える

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 残存する重複列挙を目視で突き合わせる
npm run validate:json
grep -n "test:wasm" package.json
grep -n "wasm/js-strings\|wasm/pii-sanitizer\|wasm/textrank\|wasm/sentence-dedup\|wasm/tag-cooccur\|Run wasm crate" .github/workflows/ci.yml
grep -n "sentence-dedup\|STAGED\|publicAssets\|wasmCrates" wxt.config.ts
grep -n "WASM コア" CONTEXT.md
cat wasm/crates.json
```

### file:line付き証拠

- `package.json:13` — `test:wasm` が `cd wasm/js-strings && cargo test && cd ../pii-sanitizer && ...` の 5 ディレクトリ硬直 chain。`js-strings` は lib-only であり manifest 外にのみ存在する（build 対象 4 crate と非対称）
- `.github/workflows/ci.yml:83-92` — cache path の 5 クレート列挙（`wasm/js-strings/target` から `wasm/tag-cooccur/target` までの直書き）。lock キーの `hashFiles('wasm/*/Cargo.lock')` は既に汎用であり、path 列だけが硬直している
- `.github/workflows/ci.yml:95` — step 名に 5 crate の prose 列挙（`js-strings + pii-sanitizer + textrank + sentence-dedup + tag-cooccur`）。crate 追加のたびに step 名の同調が必要な構造
- `.github/workflows/ci.yml:129`・`.github/workflows/ci.yml:132` — 文字相同の 7-path parity vitest 呼び出し 2 行（fresh rebuild 用と committed binary 用）。同期強制なしに 2 行の一致を維持する必要がある
- `wxt.config.ts:152-161` — manifest 駆動 loop（`wasm/crates.json` を読み `publicShip` のみ出荷）。本 PBI で矛盾解消の基準になる側である
- `wxt.config.ts:207-211` — CSP コメントの sentence-dedup STAGED prose（`not yet called from production`・`its binary is not shipped`・`no publicAssets entry, no public/wasm copy` の記述）。直上の manifest 駆動 loop と矛盾する prose 管理である
- `wxt.config.ts:216` — grep 検索パターン文字列（`sqlite-wasm\|WebAssembly\|pii-sanitizer\|textrank\|sentence-dedup\|tag-cooccur`）。列挙ではなく検証用パターンであり benign として対象外と明記する
- `CONTEXT.md:29` — WASM コア行が 3 クレートのみ列挙（`wasm/pii-sanitizer/`・`wasm/textrank/`・`wasm/sentence-dedup/`）。出荷済みの tag-cooccur と js-strings が欠落している
- `wasm/crates.json:3` — comment の invariant 宣言（`no other enumeration file may list crates`）。上記の重複列挙により現在偽である
- `wasm/tag-cooccur/src/cooccur.rs:18-19` — 陳腐 doc 2 行（JS `\s` と Rust `White_Space` の差異に関する記述。drive-by 更新対象）
- `wasm/js-strings/src/jsstring.rs:1-2` — 陳腐 doc 2 行（`shared by the textrank and sentence-dedup WASM cores` の記述。tag-cooccur への共有が漏れている）
- `scripts/validate-json.mjs:43-48` — `validate:json` の対象 JSON 列挙（`docs/version.json`・`dev-docs/metrics/history.json`・`sbom.json`・`package.json`）。`wasm/crates.json` を通るか着手前に確認する

### 実装手順

1. design-it-twice を本 PBI に記録する（案 A: 第二配列、案 B: `kind` field）。`js-strings` の分類と testDirs mapping の置き場所を決め、却下案の理由を残す
2. manifest に `js-strings` の分類と testDirs mapping（crate から TS parity suite dirs への対応）を足し、loader（`scripts/wasm-crates.mjs`）のサブコマンドで test 対象列・cache target 列・parity 引数列を導出できるようにする
3. `package.json:13` の `test:wasm` shell chain を manifest 駆動に置き換え、実行対象集合が等価であることを確認する
4. CI の cache path 列挙と step 名 prose 列挙を manifest 駆動（loader script のサブコマンド化）に置き換え、cache の意味論（key・restore-keys・registry path）が変わらないことを確認する
5. CI の 7-path parity 2 行呼び出しを testDirs mapping 由来の helper 1 本化に置き換え、fresh / committed の両実行の対象集合が等価であることを確認する
6. prose を同梱更新する（wxt CSP コメント・CONTEXT.md WASM コア行・`cooccur.rs:18-19`・`jsstring.rs:1-2`）。`wxt.config.ts:216` の grep パターンは対象外として明記を残す
7. `npm run validate` が green であることと `validate:json` が `wasm/crates.json` を通ることを確認する

### 落とし穴

- `build:wasm`・postprocess・publicAssets・cmp ゲートの赤・緑条件を壊さないこと（本 PBI は周縁の一本化であり、PBI 2026-09-21-18 のゲート意味論を維持する）
- CI workflow 内で manifest の loop 読みができない場合、YAML に列挙を戻さず loader script のサブコマンド化で逃がすこと（YAML への再列挙は invariant を偽に戻す）
- `js-strings` を build 対象に昇格させないこと（lib-only である。test 対象と build 対象の非対称は `kind` または第二配列のどちらでも明示的に保つ）
- parity の fresh / committed 2 実行を 1 実行に潰さないこと（1 本化するのは引数列の生成元であり、実行回数ではない）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（重複列挙の残存がないことをレビューで確認する）
- [x] 統合検証 green（`npm run validate` および wasm ゲート相当検査が green）
