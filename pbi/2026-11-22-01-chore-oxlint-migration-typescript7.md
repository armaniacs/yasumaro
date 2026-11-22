# PBI: 2026-11-22-01-chore-oxlint-migration-typescript7

> 状態: Goal A 完了（`refactor/oxlint-migration-impl` ブランチ、`npm run validate` green）。本 PBI は当初 oxlint 全面移行と
> TS7 同時移行を一体で扱ったが、なぜなぜ分析（[dev-docs/why-oxlint-typescript7.md](../dev-docs/why-oxlint-typescript7.md)）
> で **2つの独立した目的に分離** できると判明したため再構成した:
> - **Goal A（本 PBI の主軸）**: TS7 アンブロック。ブロッカーは `@typescript-eslint/*`（peer `<6.1.0`）と
>   `typedoc`（peer `6.0.x`）だけ。eslint コア(peer は jiti のみ)は無関係。RuleTester の parser を oxc アダプタへ
>   差し替え、lint を oxlint へ寄せて typescript-eslint を外し、TS7 + tsgo へ。
> - **Goal B（別 PBI に切り出し）**: eslint 完全撤去（RuleTester を自前ハーネス化、`eslint` コアも依存から削除）。
>   TS7 には不要で、高速化/依存削減の副次目的。本 PBI では扱わない。
>
> 前提調査は [dev-docs/investigation-oxlint-migration.md](../dev-docs/investigation-oxlint-migration.md)（実読・PoC）、
> 意思決定は [dev-docs/why-oxlint-typescript7.md](../dev-docs/why-oxlint-typescript7.md)。
>
> **旧PBI（typescript-eslint 残置ルート）との関係**: [2026-09-26-12-backlog-typescript-7-adoption.md](2026-09-26-12-backlog-typescript-7-adoption.md)
> は typescript-eslint を残したまま上流対応を待つ別ルート。同 PBI の実測（TS7 は CJS exports 削除で
> `--legacy-peer-deps` でも typescript-estree がクラッシュ）が、本ルート（typescript-eslint を抜く）の根拠。

## ユーザーストーリー

開発者として、TypeScript 7 への install ブロッカー（`@typescript-eslint/*` と `typedoc` の peer 制約）を
取り除きたい。なぜなら、これらが `typescript <6.1.0` / `6.0.x` に縛るため TS7 への install が ERESOLVE で
失敗し、上流対応を待つ間ずっとツールチェーンが 6.0.x に固定されるから。lint を oxlint へ寄せ、
RuleTester の parser を oxc アダプタへ差し替えれば、typescript-eslint を外して TS7 + tsgo にできる
（eslint 完全撤去=Goal B は別 PBI）。

## ビジネス価値

- TypeScript 7 の install ブロッカー（typescript-eslint + typedoc の peer 制約）を解消
- lint を Rust ネイティブの oxlint に寄せ、`eslint .`（実測 ~17s）から高速化
- 層/シーム強制（LAYERS.md）を単一の lint 設定（`.oxlintrc.json`）に集約し、二重管理を解消
- （Goal B で eslint コアも外せばサプライチェーン面も縮小。本 PBI の範囲外）

## BDD 受け入れシナリオ

```gherkin
Scenario: oxlint が自作12ルール相当のゲートを維持する
  Given oxlint 移行後のリポジトリ
  When   oxlint を lint スクリプトで実行する
  Then   層違反・seam迂回・テスト品質違反が従来どおり検出される

Scenario: TypeScript 7 のブロッカーだけが依存から消える
  Given package.json の devDependencies
  When   npm ls @typescript-eslint/parser typedoc を実行する
  Then   いずれも解決されない（TS7 ブロッカー撤去）
  And    eslint コアは RuleTester 用に残ってよい（Goal B の対象）

Scenario: TypeScript 7 が install できる
  Given typescript ^7 を devDependencies に指定した状態
  When   npm install を実行する
  Then   ERESOLVE で失敗せず、type-check が tsgo（TS7 native）で green
```

## 受け入れ基準

- [x] 自作12ルール（A: テスト品質6 / B: 層・seam3 / C: セキュリティ3）が oxlint（JSプラグイン含む）で等価に動作する
- [x] `lint` スクリプトが `oxlint` 主軸になる（`eslint.config.js` のロジックを `.oxlintrc.json` + 生成器へ）
- [x] `@typescript-eslint/parser` を RuleTester から oxc アダプタ（`eslint/oxc-parser-adapter.mjs`）へ差し替え、
      `@typescript-eslint/eslint-plugin` を依存から撤去
- [x] `typescript` を ^7 に更新し、`type-check` が通る（tsc → tsgo 切替を含む）
- [x] `typedoc` の TS7 peer 未対応を解決（Option B: typedoc を撤去し docs 生成経路を廃止。why-why の根拠は
      [dev-docs/why-oxlint-typescript7.md](../dev-docs/why-oxlint-typescript7.md)）
- [x] `npm run validate` が green（type-check/test/lint/check-docs-chars 等すべて）
- [x] `eslint` コアの完全撤去は Goal B（別 PBI）。本 PBI では eslint コアを RuleTester 用に残す（`eslint@10.15.0` と `eslint/oxc-parser-adapter.mjs` で維持確認済み）

## テスト戦略（t_wada スタイル）

### E2E テスト
- なし（lint 設定の移行であり E2E 相当は `npm run validate` の lint パスで代替）

### 統合テスト
- 移植版ルール群を oxlint の JS プラグインとしてロードし、RuleTester 相当で
  従来の `eslint/__tests__/*.test.ts`（14ファイル）の valid/invalid ケースが同結果になることを検証

### 単体テスト
- スコープ解析依存（`isLocalChrome`/`isLocalConsole`）と `ChainExpression` 正規化が
  oxlint AST で等価に判定できることの単体検証
- `utils-layer-boundary` の allow（from/to/reason）と re-export/dynamic import 解析の等価性

比率: E2E:統合:単体 = 0:3:7

## 見積もり

暫定 **8 SP**（🔴高。Goal A に再構成し eslint 完全撤去=Goal B を切り出したため 10→8）:
- lint 実装 PoC（oxlint-plugin + gen-oxlintrc + 実コードパリティ）: 0（完了）
- RuleTester を oxc アダプタへ（`eslint/oxc-parser-adapter.mjs`）: 2（`import type` ケース PASS 実測済み）
- lint を oxlint へ切替 + .js fixture parser差異(TS8016)対処: 2
- `@typescript-eslint/eslint-plugin` 撤去（parser は oxc アダプタへ）: 1
- typescript ^7 + type-check を tsgo へ + typedoc peer 解決: 3

前提（すべて実測確認済み）: oxlint JS プラグイン API 全動作、実コードで ESLint と local パリティ一致、
oxc-parser を `range:true` + loc 復元 + tokens/comments 空付与で ESLint parser 化可能（RuleTester 動作）。
残コストは「RuleTester の oxc アダプタ化」「lint を oxlint へ」「TS7+tsgo+typedoc」が中心。
Goal B（eslint 完全撤去・自前テストハーネス化）は別 PBI で別途見積もり。

## 技術的考慮事項

- 依存: oxlint（本体）、必要なら `oxlint-plugin-eslint`（`no-restricted-syntax` 相当）。
  `eslint-plugin-oxlint` は中間案（ESLint残置）選択時のみ。
- 最大リスク: ~~oxlint JS プラグインが getScope 等を再現するか~~ → **PoC で全動作確認済み（解消）**。
  残るのは alpha 機能（2026-11 alpha）への依存リスクと、プラグイン形式化（`meta.name`）の手間。
- AST差異: `OptionalMemberExpression`（非標準）は ESTree 準拠の oxlint で `ChainExpression`
  （`optional: true`）へ正規化が必要（no-raw-storage / no-direct-console-log の2個）。
- SSOT: `utils-layer-boundary` の file lists は `scripts/lint-layers-docs.mjs` が SSOT 参照。
  移植時はこの参照剥離/向け先変更も必要。
- テスタビリティ: 既存 `eslint/__tests__` は ESLint の RuleTester + repeat-safe ラッパに依存。
  oxlint 移植後は別テストハーネス（oxlint JS プラグインを直接呼ぶ）へ切替。
- 非機能: lint 実行時間、`validate` 全体の wall time 短縮を計測して PR に before/after を添付。
- ロールバック: oxlint 単独化は影響が lint/type-check に限定される。問題時は
  `eslint.config.js` を戻す revert で復旧可。TS7 は typescript ^6.0.3 への再 pin で戻す。

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）
```bash
# 自作ルール数と正体（12個 + 共有ヘルパ ast-walk.mjs）
ls eslint/rules/
# スコープ/文脈 API 依存ルールの洗い出し
grep -rln "getScope\|getAncestors\|context.filename\|context.options" eslint/rules/
# 非標準 AST ノード使用箇所
grep -rn "OptionalMemberExpression" eslint/rules/
```

### 段階的実装手順（Goal A: TS7 アンブロック）
1. **検証 PoC**: ~~`npx @oxlint/migrate` で機械差分~~ → **完了（2026-11-22 実測）**。
   コアルール6個のみ変換、自作13個は Not Implemented。JSプラグイン API（getScope/getAncestors/
   getText/node.parent/context.options/context.filename/messageId）の全動作を確認。
   optional chain は `ChainExpression`（ESTree準拠）。詳細は investigation-oxlint-migration.md。
2. **lint の実装 PoC**: ~~12ルールを oxlint JS プラグイン経由で実コードパリティ~~ → **完了（2026-11-22）**。
   `eslint/oxlint-plugin.mjs`（12ルール無改造ロード）+ `scripts/gen-oxlintrc.mjs`（eslint.config.js→
   .oxlintrc.json 生成、allow/ignores 転記）で ESLint と local パリティ一致（両者1件）。
3. **RuleTester の parser を oxc 化**: `eslint/oxc-parser-adapter.mjs` を新設（oxc-parser を
   `range:true` + ソースから loc 復元 + tokens/comments 空付与で ESLint parser 化）。
   `utils-layer-boundary.test.ts` の `@typescript-eslint/parser` をこれへ差替。
   残り13テストは JS スニペットで espree のままでよい。`import type` ケースが PASS することを実測済み。
4. **lint 切替**: `lint` スクリプトを `oxlint` へ。`eslint.config.js` は lint 用途を卒業
   （RuleTester 用に eslint コアは残す）。`gen-oxlintrc.mjs` の SSOT を段階的に移譲。
   `.js` fixture（test-pages）の parser 差異(TS8016)を解消。
5. **typescript-eslint 撤去**: `@typescript-eslint/eslint-plugin` を依存から削除（parser は 3 で
   oxc アダプタへ置換済み）。`@typescript-eslint/*` が二度と install を止めないことを確認。
6. ~~**TS7 + tsgo**: `typescript` を ^7 に、`type-check` を tsgo へ切替。~~ → **完了（2026-11-22）**。
   `typescript` を ^7.0.2 へ。**typedoc は Option B で撤去**（TS7 peer `6.0.x` と共存不可、Chrome 拡張で
   API doc 需要ゼロ）。`tsc --version`=7.0.2、`type-check`（src）は 0 errors。
   **副作用（tsgo の exit-code 逆転）**: TS6 は type error→exit 2 / config break→exit 1。TS7 は
   type error→**exit 1** / config break(TS18002/18003/6053)→**exit 2** へ逆転。`type-check:test` の
   ベースラインゲート（`scripts/check-type-test-baseline.mjs`）の sanity check を TS7 規約へ更新
   （`expected exit 1`）。加えて tsgo は declaration nameability(TS4023)を `noEmit` 下でも検査し、
   `seeded-history-panel.fixture.ts` の export `test` が非公開 `ExtensionFixtureOptions` を参照して
   1件顕在化 → インタフェースを export して負債1件返済（baseline 439 維持、つり上げ禁止の原則どおり）。
7. ~~`npm run validate` を green にし、lint before/after 時間を PR に添付。~~ → **完了（2026-11-22）**。
   `validate` green（1343 files / 18929 tests、lint + type-check + type-check:test:baseline + check-docs-chars）。
   lint before/after: `eslint .` 実測 ~17s(cold)/3.1s(warm) → `oxlint` 0.52〜0.69s(binary) / 0.7s(`npm run lint`)。
   `eslint` コアの完全撤去（Goal B）は本 PBI の範囲外。

### Goal B（別 PBI・本 PBI 範囲外）
- eslint コアの依存撤去、RuleTester を自前ハーネス（vitest で oxc アダプタ直接呼び）へ、
  `eslint.config.js`/`eslint/rules/**`/`eslint/__tests__/**` の整理。TS7 には不要な高速化/依存削減。

### 落とし穴
- `context.filename` による seam/test 除外ゲートは、oxlint でファイル文脈の取得方法が
  異なる可能性がある（プラグイン API の差異を PoC で最初に確認）。
- allowlist 3ルールは file/reason を `.oxlintrc.json` のスキーマに載せ替える必要があり、
  reason 必須の思想（「無根拠の迂回を防ぐ」）を維持すること。
- `no-greedy-fake-timers` は warn（124箇所残）なので、error 化で一気に落とさない。
- TS7 は typescript-eslint 以外に typedoc も peer で未対応。docs ビルド経路の扱いを決めること。

## Definition of Done

- [x] 全BDDシナリオが自動テスト（validate の lint + type-check）でパスする
- [x] 既存 `eslint/__tests__`（14ファイル）相当の valid/invalid ケースが移植版で同結果
- [x] `npm run validate` が green（type-check/test/lint/check-docs-chars 等）
- [x] lint before/after の実行時間を計測し PR に添付（eslint ~17s → oxlint ~0.7s）
- [ ] コードレビュー完了（GitHub PR approve 必須）
- [x] ロールバック手段（eslint.config.js 復元 / typescript 再 pin）を本項に記載済み
- [x] ドキュメント更新: AGENTS.md の lint 手順・dev-docs/investigation-oxlint-migration.md を最終形へ（AGENTS.md:41 と investigation 最終結果セクションで確認）
- [x] CHANGELOG.md に依存更新（oxlint 導入 / eslint 撤去 / TS7）を追記（Unreleased 依存更新に記載済み）