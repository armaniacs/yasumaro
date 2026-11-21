# PBI: 2026-11-22-01-chore-oxlint-migration-typescript7

> 状態: 草案（未着手・要見積もり）。本 PBI は oxlint 全面移行と TypeScript 7 同時移行を
> 一体で扱う。前提調査は [dev-docs/investigation-oxlint-migration.md](../dev-docs/investigation-oxlint-migration.md)
> に実読ベースで記録済み。着手前に「実装者向け注記」の検証手順を必ず実行すること。
>
> **旧PBI（typescript-eslint 残置ルート）との関係**: [2026-09-26-12-backlog-typescript-7-adoption.md](2026-09-26-12-backlog-typescript-7-adoption.md)
> は typescript-eslint を残したまま上流対応を待つ別ルートで、本 PBI と併存する。同 PBI の実測
> （TS7 は CJS exports 削除で `--legacy-peer-deps` でも typescript-estree がクラッシュ）が、
> 「typescript-eslint を抜く」本ルートの根拠になっている。本 PBI の 13 SP は旧 PBI の 2 SP
> （typescript/typescript-eslint/typedoc 同時更新のみ）を包含する。共通の残ブロッカーは
> `typedoc`（TS7 peer 未対応）で、typescript-eslint を撤去しても docs ビルド経路の解決が別途必要。

## ユーザーストーリー

開発者として、lint を oxlint へ全面移行し typescript-eslint を撤去したい。なぜなら、
typescript-eslint が `typescript <6.1.0` に peer 依存するため TypeScript 7 への install が
ERESOLVE で失敗し、上流対応を待つ間ずっとツールチェーンが 6.0.x に固定されるから。
oxlint は型ベース lint のバックエンドに tsgo（TypeScript 7 native）を内蔵するため、
自作ルールを移植できれば TS7 の install ブロッカーを根本から除ける。

## ビジネス価値

- TypeScript 7 の install ブロッカー（typescript-eslint の peer 制約）を解消し、将来の TS7 移行を即応化
- lint を Rust ネイティブの oxlint に寄せ、`eslint .`（実測 ~17s）から高速化
- ESLint + typescript-eslint + 各種 eslint-plugin の依存ツリーを撤去し、サプライチェーン面を縮小
- 層/シーム強制（LAYERS.md）を単一の lint 設定（`.oxlintrc.json`）に集約し、二重管理を解消

## BDD 受け入れシナリオ

```gherkin
Scenario: oxlint が自作12ルール相当のゲートを維持する
  Given oxlint 移行後のリポジトリ
  When   oxlint を lint スクリプトで実行する
  Then   層違反・seam迂回・テスト品質違反が従来どおり検出される

Scenario: ESLint と typescript-eslint が依存から消える
  Given package.json の devDependencies
  When   npm ls eslint @typescript-eslint/parser を実行する
  Then   いずれも解決されない（撤去完了）

Scenario: TypeScript 7 が install できる
  Given typescript ^7 を devDependencies に指定した状態
  When   npm install を実行する
  Then   ERESOLVE で失敗せず、type-check が tsgo（TS7 native）で green
```

## 受け入れ基準

- [ ] 自作12ルール（A: テスト品質6 / B: 層・seam3 / C: セキュリティ3）が oxlint（JSプラグイン含む）で等価に動作する
- [ ] `eslint` / `@typescript-eslint/*` / `eslint-plugin-*`（vitest含む）を devDependencies から撤去
- [ ] `eslint.config.js` と `eslint/rules/**` を `.oxlintrc.json`（＋移植版プラグイン）へ置き換え
- [ ] `lint` スクリプトが `oxlint` 単独（または oxlint + 最小限の ESLint 残置: 中間案選択時）になる
- [ ] `typescript` を ^7 に更新し、`type-check` が通る（tsc → tsgo 切替を含む）
- [ ] `npm run validate` が green（type-check/test/lint/check-docs-chars 等すべて）
- [ ] `typedoc` の TS7 peer 未対応を解決済み、または docs ビルド経路から除外

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

暫定 **10 SP**（🔴高。Group A 移植 PoC で実コード・パリティ一致を確認し 11→10 に下方修正）:
- 検証 PoC（@oxlint/migrate 差分 + API probe）: 0（完了）
- Group A 移植（スコープ非依存寄り・6個）: 2（**PoC完了**: 12ルール無改造で oxlint 動作・実コードでパリティ一致）
- Group B 移植（層/seam・スコープ/allow依存・3個）: 3
- Group C 移植（3個）＋ ChainExpression 正規化: 2（**ChainExpression 正規化は未了**）
- typescript-eslint 撤去 + TS7 + tsgo 切替 + .js fixture parser差異(TS8016)対処: 3

前提: `getScope`/`getAncestors`/`getText`/`node.parent`/`context.options`/`context.filename`/
`messageId`+`meta.messages`+`data` の全動作を実測確認済み。**実コードで ESLint と local ルールの
パリティ一致（両者1件）を確認済み**。足場は `eslint/oxlint-plugin.mjs` + `scripts/gen-oxlintrc.mjs`
（`eslint.config.js` を SSOT に `.oxlintrc.json` を生成）。
残コストは「2個の ChainExpression 正規化」「テストハーネス（RuleTester）を oxlint 互換へ」
「.js fixture の parser 差異(TS8016)」「eslint 依存撤去 + tsgo 切替」が中心。

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

### 段階的実装手順（案C: 全面移行）
1. **検証 PoC**: ~~`npx @oxlint/migrate eslint.config.js` で `.oxlintrc.json` を生成~~ → **完了（2026-11-22 実測）**。
   結果: コアルール6個のみ変換、自作12個 + `no-restricted-syntax` = 13個は "Not Implemented"（ネイティブ等価物なし）。
   JSプラグイン最小 probe で `getScope`/`getAncestors`/`getText`/`node.parent`/`context.options`/`context.filename` の
   全てが動作することを確認。optional chain は `ChainExpression`（ESTree準拠）で `OptionalMemberExpression` は出ない。
   詳細は [dev-docs/investigation-oxlint-migration.md](../dev-docs/investigation-oxlint-migration.md) の「検証 PoC 結果」。
    → 案C は技術的に可行。SP を 13→**11** に下方修正（Group B のスコープ再現リスクが実測で解消）。
2. **Group A 移植**（スコープ非依存寄り）: no-tautology-expect / no-fixed-wait / no-greedy-fake-timers /
   no-manual-protocol-version / require-sanitized-markdown / require-response-size-limit。
   → **PoC完了（2026-11-22）**: `eslint/oxlint-plugin.mjs` で12ルールを無改造ロード、
   `scripts/gen-oxlintrc.mjs` で `eslint.config.js`→`.oxlintrc.json` を生成し、実コードで
   ESLint と local ルールのパリティ一致（両者1件）を確認。SP 11→10。
   残: テストハーネス（RuleTester）を oxlint 互換へ切替。
3. **Group C**: no-dead-test-skip。＋ ChainExpression 正規化（no-raw-storage / no-direct-console-log）。
   ※ 現状 2個は `OptionalMemberExpression` 判定のままだが、現コードに optional chain 違反が無く
   パリティは成立。正式移植で `ChainExpression`（optional フラグ）判定へ改める。
4. **Group B**（最難関）: utils-layer-boundary / no-raw-storage / no-direct-console-log。
   スコープ解析（isLocalChrome/isLocalConsole）と allow（file/reason）を移植。
   （allow は既に gen-oxlintrc が eslint.config.js から転記済み。）
5. **撤去**: `eslint` / `@typescript-eslint/*` / `eslint-plugin-*` を devDependencies から削除、
   `eslint.config.js`・`eslint/rules/**`・`eslint/__tests__/**` を削除または移植版へ置換。
   `lint` スクリプトを oxlint へ。`gen-oxlintrc.mjs` の SSOT を eslint.config.js から
   移植後の設定へ向け先変更。`.js` fixture（test-pages）の parser 差異(TS8016)を解消。
6. **TS7**: `typescript` を ^7 に、`type-check` を tsgo へ切替。`typedoc` の TS7 peer を解決
   （tsgo 対応版 or docs 経路の分離）。
7. `npm run validate` を green にし、lint before/after 時間を PR に添付。

### 中間案（案B）との分岐
- 検証 PoC で `getScope`/`getAncestors` の再現度が低く Group B 移植が過大と判断された場合、
  Group A/C のみ oxlint へ逃がし Group B を ESLint 残置する中間案に切替える。
  その場合 typescript-eslint が残るため TS7 の install ブロッカーは残る（TS7 は別 PBI 送り）。
  この分岐はユーザーが明示的に裁定する。

### 落とし穴
- `context.filename` による seam/test 除外ゲートは、oxlint でファイル文脈の取得方法が
  異なる可能性がある（プラグイン API の差異を PoC で最初に確認）。
- allowlist 3ルールは file/reason を `.oxlintrc.json` のスキーマに載せ替える必要があり、
  reason 必須の思想（「無根拠の迂回を防ぐ」）を維持すること。
- `no-greedy-fake-timers` は warn（124箇所残）なので、error 化で一気に落とさない。
- TS7 は typescript-eslint 以外に typedoc も peer で未対応。docs ビルド経路の扱いを決めること。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト（validate の lint + type-check）でパスする
- [ ] 既存 `eslint/__tests__`（14ファイル）相当の valid/invalid ケースが移植版で同結果
- [ ] `npm run validate` が green（type-check/test/lint/check-docs-chars 等）
- [ ] lint before/after の実行時間を計測し PR に添付
- [ ] コードレビュー完了（GitHub PR approve 必須）
- [ ] ロールバック手段（eslint.config.js 復元 / typescript 再 pin）を本項に記載済み
- [ ] ドキュメント更新: AGENTS.md の lint 手順・dev-docs/investigation-oxlint-migration.md を最終形へ
- [ ] CHANGELOG.md に依存更新（oxlint 導入 / eslint 撤去 / TS7）を追記