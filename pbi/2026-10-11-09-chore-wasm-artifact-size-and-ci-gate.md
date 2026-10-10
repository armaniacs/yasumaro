# PBI: WASM 成果物のサイズを削減し、出荷バイナリのサイズゲートを CI に追加する

- 種別: chore
- RICE: 3.0（R3 × I1 × C1.0 / E1.0）
- 依存: **PBI-01 の後**（wasm を再ビルドするため。PBI-01 が `core5.rs` / `lib.rs` を変更して成果物のバイトが確定してから着手する）。CI の paths フィルタ修正は PBI-01 と独立に先行してよい
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）SRE/Ops Medium 1件 + Edge & Mobile Medium 1件（同一原因につき統合）+ Supply Chain Medium 1件

## ユーザーストーリー

ストレージ制約のある端末のユーザーとして、拡張の更新で不要なバイナリをダウンロードしたくない。なぜなら出荷する PII WASM が 2.16 倍（46,629 → 100,671 B）になり、増分の 71% はデバッグ用シンボル名で、それを検出するゲートも無いから。

## 背景（現状・証拠）

### 出荷成果物の肥大

- コミット `7e328646`（overlapping-chunk の Rust 移植）で `public/wasm/pii_sanitizer_bg.wasm` と `src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm` が 46,629 → 100,671 B になった。
- セクション解析: 増分 54,042 B のうち **38,612 B が `custom:name`**（デバッグ用シンボル名。全体の 38.4%、増分の 71%）。コードセクションの実増は +14,371 B、data は +712 B。
- 本プロジェクトの他 crate（`public/wasm/tag_cooccur_bg.wasm` 79,453 B、`public/wasm/textrank_bg.wasm` 37,590 B）はどちらも `producers` のみで name セクションを持たず、pii だけが慣例から外れている。
- 実行時コストは実測で無視できる: compile p50 0.136 → 0.173 ms、wasm linear memory は新旧とも `arrayBuffers` 0.14 MB（60KB 入力 20 回処理で不変）。つまり問題は「配布物サイズ」に限定され、strip で 71% を回収できる（strip 後 62,059 B ≒ 旧 +15.4KB 相当）。
- `scripts/build-wasm.mjs:36-58` の plan には strip / 最適化ステップが無い。`wasm/pii-sanitizer/Cargo.toml` の `[profile.release]` は `opt-level = "z"` / `lto = true` / `codegen-units = 1` / `panic = "abort"` までで `strip` が無い。
- 本機に `wasm-opt` / `wasm-strip` はインストールされていない（`command -v` で確認済み）。したがって strip は Cargo プロファイル（`strip = true` / `strip = "symbols"`）で行うのが現実的。wasm-bindgen が後段で再付与する可能性があるため、**再ビルドして消えることを実測で確認する**。
- `src/wasm/pii-sanitizer/index.ts:39` の「~47KB binary」という記述は実測値（100,671 B）と食い違う。

### サイズゲートの不在

- `.github/workflows/ci.yml:225-260` の wasm ゲートは「fresh rebuild と committed の両方がパリティを満たす」ことのみを検証し、バイナリのサイズ検査を意図的に行わない（コメントに明記）。
- 唯一のサイズゲートは `scripts/check-bundle-size.mjs:22-23` の上限 15MB で、`.github/workflows/release.yml:40-45` により**リリース時のみ**実行される。
- したがって 38.6KB の増加はどのゲートにも掛からず、成果物の肥大がレビューで検知されない。

### 片側差し替えがゲートをすり抜ける

- `.github/workflows/ci.yml:65-71` の `wasm` paths フィルタは `wasm/**` / `scripts/wasm-crates.mjs` / `package*.json` / workflows のみで、**`public/wasm/**` を含まない**（`:183-185` の `wasm-test` ジョブ実行条件）。
- ゲート本体 `:225-260` は `scripts/wasm-crates.mjs check` で src↔public の byte 一致を検査し、「片側コミットは失敗させる」と明記している（`scripts/wasm-crates.mjs:318-330`）。
- しかし実際に配布されるのは `public/wasm/pii_sanitizer_bg.wasm`（`wxt.config.ts` の publicAssets 経由）であり、`public/wasm/*.wasm` だけを差し替える PR では rebuild パリティも src↔public のバイト比較も走らない。
- 本ブランチの成果物自体は問題なし（`cmp public/wasm/pii_sanitizer_bg.wasm src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm` 一致、ローカルの `npm run build:wasm` 生成物とも byte 一致）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 出荷 PII WASM が strip されてサイズが減る
  Given wasm/pii-sanitizer/Cargo.toml に strip 設定が入っている
  When npm run build:wasm を実行する
  Then pii_sanitizer_bg.wasm の custom:name セクションが消え、サイズが現状より小さくなる
  And TS/WASM のパリティテストが green のままである

Scenario: サイズ上限を超えたら CI が落ちる
  Given crate 単位のサイズ上限が設定されている
  When 上限を超える wasm がコミットされる
  Then wasm ジョブが失敗する

Scenario: public/wasm だけの差し替えでもゲートが走る
  Given public/wasm/pii_sanitizer_bg.wasm のみを変更した PR である
  When CI が paths フィルタでジョブを選ぶ
  Then wasm ジョブが起動し、src↔public の不一致を検出して失敗する
```

## 受け入れ基準

- [ ] `wasm/pii-sanitizer/Cargo.toml`（および必要な場合は他 crate）に strip 設定を追加し、`npm run build:wasm` で `custom:name` が消えることをセクション解析で確認する
- [ ] strip 後のサイズを実測して記録する（目標: `pii_sanitizer_bg.wasm` が現状 100,671 B から大幅に減る。wasm-opt が使えないため Cargo strip で届く範囲を記録し、届かない分は残存として明記する）
- [ ] `src/wasm/pii-sanitizer/index.ts:39` の「~47KB binary」記述を実測値に直す
- [ ] `.github/workflows/ci.yml:65-71` の `wasm` paths フィルタに `public/wasm/**` を追加する
- [ ] CI の wasm ジョブに crate 単位のサイズ上限を追加する（現状値に余裕を持たせた閾値。超えたら fail）。`scripts/wasm-crates.mjs` の `crates.json` を SSOT として使う
- [ ] strip 後も TS/WASM パリティ（`parity.test.ts` / `extended-patterns-parity.test.ts`）と `npm run test:wasm` が green
- [ ] `node scripts/wasm-crates.mjs check` が green（src↔public の byte 一致）
- [ ] `docs/PERFORMANCE_TEST.md` または `bench/README.md` に「wasm 成果物サイズ」の行を設け、PBI 単位で増分を記録する運用を明記する
- [ ] `npm run validate` が green

## テスト戦略

- ビルド検証: `npm run build:wasm` → wasm セクション解析（`custom:name` の有無とサイズ）→ `node scripts/wasm-crates.mjs check`
- 回帰: `npm run test:wasm`（Rust 単体 + パリティ）
- CI 検証: paths フィルタ変更が `wasm` / `lint` / `test` / `e2e` の他ジョブに副作用しないこと（YAML の構文と `gh workflow view` 相当の確認）
- 手動: サイズ上限を意図的に超えるダミーで fail することをローカルで確認（上限チェックのロジックを直接実行）

## 見積もり

1.0 SP（strip 設定と実測 0.5 + CI ゲート 0.5）

## 技術的考慮事項

- **PBI-01 の後に実施する**（wasm 再ビルドが 2 回にならないようにする）。CI の paths フィルタ修正だけは先行してよい
- `wasm-opt -Oz` を使う場合は依存の追加（バイナリ配布）が必要になる。本 PBI では**追加ツールに依存しない Cargo strip を第一手段**とし、`wasm-opt` は採用しない（供給網を増やさない）
- サイズ上限は「strip 後の実測値 + 余裕」で設定する。厳しすぎる上限は正当な機能追加をブロックする
- `crates.json` を SSOT にする（crate ごとの列挙を新設しない）
- 出荷バイナリの byte 来歴（再現性）は本 PBI のスコープ外（`pbi/2026-09-25-26-backlog-wasm-binary-reproducibility-watch.md` の監視対象のまま）

## 実装者向け注記

### 実装手順

1. `wasm/pii-sanitizer/Cargo.toml` の `[profile.release]` に `strip = true`（効果が無ければ `strip = "symbols"`）を追加
2. `npm run build:wasm` を実行し、`src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm` のサイズとセクションを確認（`node -e` で section 名を走査するか、`wasm-objdump` が無ければバイト列から `custom`/`name` を探索）
3. `custom:name` が残る場合は wasm-bindgen の後段付与を疑い、`scripts/postprocess-wasm-glue.mjs` の前後を確認する
4. CI の paths フィルタとサイズ上限を追加
5. `npm run test:wasm` / `wasm-crates.mjs check` / `npm run validate`

### 落とし穴

- strip で TS/WASM のパリティが壊れてはならない（壊れたら strip 設定が過剰。実測で確認する）
- `src/wasm` と `public/wasm` の両コピーが同一バイトであることを忘れない（`wasm-crates.mjs check` が検出する）
- サイズ上限を `crates.json` に持たせる場合、`scripts/wasm-crates.mjs` の check/build 両経路で読めるようにする（新しい列挙ファイルを作らない）

## Definition of Done

- [ ] strip 後のサイズを実測記録し、`custom:name` が消えている
- [ ] CI の paths フィルタに `public/wasm/**` が入り、サイズ上限ゲートが動く
- [ ] `npm run test:wasm` / `wasm-crates.mjs check` / `npm run validate` が green
- [ ] 成果物サイズの記録運用が文書化されている
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
