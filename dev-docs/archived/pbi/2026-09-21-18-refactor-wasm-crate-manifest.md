# PBI: WASM crate 台帳を manifest SSOT に集約する

## ユーザーストーリー

メンテナーとして、WASM crate の一覧を1箇所の manifest で管理したい、なぜなら現状は5つ目の crate 追加が4ファイルの同調編集になり、既に sentence-dedup の public 出荷可否が4箇所で不整合を起こしているから

## 優先度

- 順位: 2
- RICEスコア: **32**（Reach=8 / Impact=2 / Confidence=1.0 / Effort=0.5週）
- 根拠: STAGED drift 実績あり（sentence-dedup の public 出荷可否が prose コメントで分散記述され、build:wasm の cp 漏れ相当の不整合を既に起こしている）。以降の wasm 作業（新規 crate 追加・STAGED 昇格）の土台であり、先に集約しないと追加のたびに4ファイル同調コストが再発する

## ビジネス価値

新規 crate 追加・STAGED 昇格時の変更点が manifest の1行追加・1フィールド変更に収まり、同調漏れによる stale バイナリ・未出荷・CI 誤検知の事故を防ぐ。測定方法: 5つ目の crate 追加差分が manifest + Rust 本体のみで完結すること

## BDD受け入れシナリオ

```gherkin
Scenario: crate 追加は manifest の1箇所編集で完結する
  Given wasm/crates.json（または scripts/wasm-crates.mjs）に4 crate が登録されている
  When 5つ目の crate を manifest に1エントリ追加して npm run build:wasm を実行する
  Then wasm-pack build・glue postprocess・src コピー・public コピー・CI ゲート対象の全てに新規 crate が反映される

Scenario: STAGED 状態が field で一元管理される
  Given sentence-dedup が publicShip=false（STAGED）として manifest に登録されている
  When build:wasm と wxt.config.ts の publicAssets と CI ゲートを実行する
  Then sentence-dedup の public コピーが生成・出荷・検査のいずれにも含まれず、prose コメントの読み替えなしに挙動が一致する

Scenario: 集約後もビルド成果物とゲート意味論が変わらない
  Given 集約前後で同一の Rust ソース
  When 集約後のスクリプトで build:wasm を実行し CI の wasm ゲート相当を走らせる
  Then 生成される glue・d.ts・wasm バイナリが集約前と byte 等価であり、committed バイナリとの一致検査（cmp・git diff --exit-code）が従来通り赤・緑を返す
```

## 受け入れ基準

- [x] crate 名・gluePath・outPath・dtsName・wasmName・publicShip（STAGED 含む）を単一 manifest（wasm/crates.json または scripts/wasm-crates.mjs の1 module）が所有する
- [x] `npm run build:wasm` が shell chain の直書き列挙ではなく manifest を読む Node スクリプト経由で全 crate をビルド・コピーする
- [x] postprocess-wasm-glue と wxt.config.ts の publicAssets と CI ゲート相当検査が同一 manifest を読む（crate 列挙の重複記述が残らない）
- [x] STAGED（sentence-dedup の public 未出荷）が prose コメントではなく publicShip フィールドで表現される
- [x] ビルド成果物が集約前と byte 等価であり、CI ゲートの意味論（committed バイナリと生成物の一致検査）を壊さない
- [x] `npm run validate` が green である

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（ビルド配線のリファクタリング。拡張機能の動作自体は変えない）

### 統合テスト

- manifest にテスト用 crate を1件追加した試行で、build・postprocess・publicAssets 解決・CI ゲート相当検査の全てに反映される（red-green: manifest 追加前は対象外、追加後は対象になる）
- sentence-dedup の publicShip=false のまま build しても public/wasm に bin が出ず、publicShip=true への反転試行では出る（STAGED field の振る舞い確認）
- 集約前後の `npm run build:wasm` 成果物を byte 比較し、glue・d.ts・wasm が等価である

### 単体テスト

- manifest ローダーの単体テスト: 必須フィールド欠落・未知フィールド・パス解決失敗時に明示エラーで失敗する
- wxt publicAssets 解決関数の単体テスト: publicShip=false の crate が files.push 対象から除外される

## 実装アプローチ

- **Outside-In**: 5つ目の crate 追加の期待結果（manifest 1箇所編集で完結）から定義し、読み手側（build・postprocess・wxt・CI）を順に manifest 駆動へ寄せる
- **Red-Green-Refactor**: まず manifest を追加し既存4 crate を移行（green: byte 等価）、その後に shell chain・CRATES テーブル・files.push 列挙・CI 直書きリストを削除する
- **リファクタリング**: グリーンになるたびに重複列挙を1つずつ消し、各段階で build 成果物の byte 等価を再確認する

## 見積もり

2pt（0.5週、要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。既存4 crate のビルド成果物・出荷パスは変えない
- ci.yml の cmp・git diff --exit-code ゲートの意味論（committed バイナリと生成物の一致検査）は壊さない。CI ワークフロー直書き部分は check-wasm-binaries 相当の script 化で manifest を読む形に寄せるが、赤・緑条件は維持する
- package.json scripts の変更は npm scripts 慣習に従う（`build:wasm` の名前は維持し、実体を Node スクリプト呼び出しに置き換える）
- 非機能要件: ビルド時間の増加なし（列挙方法の変更のみ）。manifest は CJS・ESM の双方から読める形式にする（wxt.config.ts・CI script・postprocess の実行系が異なるため）
- 制約: STAGED の prose コメント（wxt.config.ts・ci.yml 内）は field 移行後に削除し、二重管理にしない

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 4箇所の重複列挙を目視で突き合わせる
grep -n "build:wasm" package.json
grep -n "CRATES\|crateLabel" scripts/postprocess-wasm-glue.mjs
grep -n "files.push\|STAGED\|sentence_dedup" wxt.config.ts
grep -n "cmp -s\|git diff --exit-code\|dedup" .github/workflows/ci.yml
```

### file:line付き証拠

- `package.json:12` — `build:wasm` が per-crate の wasm-pack build + cp x2 の shell chain（pii-sanitizer → textrank → sentence-dedup → tag-cooccur の順に直書き。sentence-dedup のみ public/wasm への cp がなく、STAGED 由来の分岐が chain 内に埋め込まれている）
- `scripts/postprocess-wasm-glue.mjs:34-63` — CRATES テーブル（gluePath・outPath・dtsName・wasmName・crateLabel）が同一4 crate を再列挙。package.json の crate 順序・命名と同調が必要な構造
- `wxt.config.ts:149-165` — files.push ブロック x3（pii・textrank・tag_cooccur の public/wasm 出荷）+ STAGED NOTE（sentence-dedup の public 未出荷が prose で記録。build:wasm の cp 有無と対で読まないと一致確認できない）
- `.github/workflows/ci.yml:121-159` — per-crate の cp・cmp -s・git diff --exit-code トリプレット + dedup 例外コメント（sentence-dedup は src コピーのみ対象の旨が prose で記述。wxt.config.ts の NOTE と同調が必要）
- `wxt.config.ts:211-215` — CSP コメント内の sentence-dedup STAGED 記述（出荷可否の prose 記録が3箇所目。field 化の際に合わせて削除する）

### 実装手順

1. `wasm/crates.json`（または `scripts/wasm-crates.mjs` の1 module）を新設し、4 crate 分の crate 名・gluePath・outPath・dtsName・wasmName・publicShip（sentence-dedup のみ false）を登録する
2. `scripts/postprocess-wasm-glue.mjs` の CRATES 直書きを manifest 読みに置き換え、生成 glue が byte 等価であることを diff で確認する
3. `npm run build:wasm` の shell chain を Node スクリプト（例: `scripts/build-wasm.mjs`）に置き換え、manifest を読んで全 crate をビルド・コピーする。成果物の byte 等価を確認する
4. `wxt.config.ts` の `build:publicAssets` の files.push x3 直書きを manifest 読み（publicShip=true のみ出荷）に置き換え、STAGED NOTE の prose を削除する
5. CI ゲート（`.github/workflows/ci.yml:121-159`）の per-crate 直書きを manifest を読む script 呼び出しに寄せ、cmp・git diff --exit-code の赤・緑条件が変わらないことを stale 試行で確認する

### 落とし穴

- ホスト間バイト比較は不可（panic パス・wasm-bindgen バナーの差異 — ci.yml 内コメント参照）。behavioral equivalence（parity 両実行）+ 同一ホスト内 cmp の構成を崩さないこと
- `package.json` の `build:wasm` は他スクリプト・CI・ドキュメントから名前参照されているため、スクリプト名は維持し実体のみ置き換えること
- manifest のパス解決は実行カレントに依存させない（`build:wasm` は cd を繰り返すため、絶対パス解決または root 基準の相対パスにすること）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（重複列挙の残存がないことをレビューで確認する）
- [x] 統合検証 green（`npm run validate` および wasm ゲート相当検査が green）
- [x] ドキュメント更新済み（STAGED の prose コメントが field 参照に置き換わる）
