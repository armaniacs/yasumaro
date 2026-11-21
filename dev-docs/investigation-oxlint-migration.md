# 調査: 自作 ESLint ルール12個の目的と oxlint 移行評価（案C）

本ドキュメントは oxlint 全面移行 + TypeScript 7 同時移行（案C）の検討のため、
`eslint/rules/` 配下の自作ルール12個を実読して目的・実装理由・AST依存を整理した調査結果。
実装の大幅変更は許容する前提。結論と移行計画は本ドキュメント末尾。

## 全体像

- 登録されているルールは **12個**（`eslint/plugin.mjs`）。`ast-walk.mjs` は12ルールが共有する
  pre-order AST走査ヘルパー（ルール本体ではない）。
- **全ルールが非型ベース**。`parserServices` / `getTypeChecker` / `program` を一切使わない。
  使うのは構文（AST）とスコープ解析（`sourceCode.getScope`）のみ。
  → このリポジトリに typescript-eslint の type-aware ルールは1つも無い
  （`no-explicit-any` / `no-unused-vars` / `no-restricted-imports` の3つも syntactic）。
- 12個すべてに個別の RuleTester テストがある（`eslint/__tests__/*.test.ts`）。

## 分類と個別目的

### A. テスト品質ゲート（6個） ― dev-docs/TEST_RULE.md / 各ADR

| ルール | 検出対象 | 実装理由（コード内コメント・PBI由来） |
|---|---|---|
| `no-tautology-expect` | `expect(A).toBe(A)` 等の恒真アサーション | 失敗不能なアサーションは回帰信号ゼロ。TEST_RULE.md の「AIが生成する無意味なテスト」検出 |
| `no-test-sleep` | `new Promise(r => setTimeout(r, N))` の N>=1ms（const解決） | 固定スリープは失敗せず wall time を浪費だけ。条件待ちを強制。ADR 2026-09-26-test-suite-execution-time-contract |
| `no-fixed-wait` | Playwright `page.waitForTimeout(n)` | 上のE2E版。遅いCIで green/flaky を分ける唯一の対処が条件待ち |
| `no-vacuous-negative-wait` | 条件が negative assertion だけの `vi.waitFor` | 同期評価で即 resolve し、ガード削除でも green になる自己前提アサーションの検出 |
| `no-dead-test-skip` | 宣言形 `it.skip('name', fn)` / `describe.skip` / `fixme` | カバレッジを隠したまま green を保つ永久スキップ。2026-03〜10に10件蓄積（PBI 2026-10-12-02/03） |
| `no-greedy-fake-timers` | `vi.useFakeTimers()` の既定 toFake（`setImmediate`/`queueMicrotask` 含む） | Vitest の module runner を飢餓させ dynamic import をハングさせる。warn（124箇所残で migration 中） |

### B. アーキテクチャ・層/シーム強制（3個） ― dev-docs/LAYERS.md / 各PBI

| ルール | 検出対象 | 実装理由 |
|---|---|---|
| `utils-layer-boundary` | `src/utils/` の層間 import（Layer0純粋性 / Layer1→Layer2禁止 / 下位層の上位層への逆辺 import・re-export・dynamic import） | LAYERS.md の依存方向を機械強制。file lists（LAYER0_FILES等）が SSOT |
| `no-raw-storage` | シーム外の `chrome.storage.local.<get/set/remove/clear/getBytesInUse>` | SettingsRepository/StoragePort が SSOT。素の呼び出しは migration/暗号化/cache を迂回（PBI 2026-11-07-02） |
| `no-direct-console-log` | シーム外の `console.<log/debug/info/warn/error>` と `.catch(console.error)` 形 | 構造化ロガー seam が SSOT。素の console は PII 消毒/persist/level を迂回（PBI 2026-11-11-03） |

### C. セキュリティ・正確性（3個）

| ルール | 検出対象 | 実装理由 |
|---|---|---|
| `require-sanitized-markdown` | markdown テンプレート `${var}` が sanitizeForObsidian 等を通っていない | Obsidian 出力への注入防止 |
| `require-response-size-limit` |  preceding size/content-length ガード無しの `response.text()` | メモリ枯渇（巨大レスポンス）防止 |
| `no-manual-protocol-version` | `sendMessage` 第一引数に手書き `protocolVersion` | MessageTransport.send() が stamp/validate する単一源を迂回させない（PBI 2026-09-28-29） |

## AST / API 依存（oxlint JS プラグイン互換性の核心）

移行可否を左右するのは、各ルールが使う SourceCode API と AST ノード型。

### 使う SourceCode API
- `context.sourceCode.getScope(node)` … スコープ連鎖を辿る（4ルール: no-test-sleep / no-direct-console-log / no-raw-storage / utils-layer-boundary）
- `context.sourceCode.getAncestors(node)` … require-response-size-limit
- `context.sourceCode.getText(node)` … 複数ルール
- `context.filename` / `context.getFilename()` … ファイル単位ゲート（seam除外・test除外）に多用
- `context.options` … allowlist 受け取り（utils-layer-boundary / no-raw-storage / no-direct-console-log）
- `context.report({node, messageId, data})` … 全ルール

### 使う visitor / ノード型
- 標準: `CallExpression` `MemberExpression` `ImportDeclaration` `TemplateLiteral` `NewExpression` `Program:exit`
- **非標準**: `OptionalMemberExpression`（`no-direct-console-log` / `no-raw-storage` が `console?.x` / `a?.b` 検出に使用）。
  ESTree 標準は `ChainExpression` + `optional: true` で、oxlint も ESTree 準拠のため**要書き換え**。

### 移行上の確定した莫非
1. `context.sourceCode.getScope` / `getAncestors` / `getText` / `context.options` / `context.filename` を
   oxlint の JS プラグイン（alpha）がどこまで再現するかが最大の実測焦点。再現されなければ12個中9個が
   スコープ/ファイル文脈依存で書き換え必須。
2. `OptionalMemberExpression` は oxlint で `ChainExpression` に正規化が必要（2ルール）。
3. allowlist（file/reason）を持つ3ルールは、`.oxlintrc.json` のスキーマに allow 配列を載せ替える
   か、JS プラグインの options で受ける必要。

## 移行計画の方向性（案C）

- 12個すべてがプロジェクト固有で oxlint ネイティブに等価物は無い。よって「ESLint撤去」には
  全12個を oxlint JS プラグインへ移植する必要がある（`oxlint-plugin-eslint` の `eslint-js/no-restricted-syntax`
  は `SettingsRepository` 禁止 = `no-restricted-syntax` 相当として流用可）。
- 移植の難所は Group B（層/シーム3ルール）。特に `utils-layer-boundary` は re-export/dynamic import まで
  解析し allow 付きで複雑。スコープ解析依存の `isLocalChrome`/`isLocalConsole` は oxlint JS プラグインの
  scope 再現度次第。
- 代替現実解: oxlint は correctness 系（Group A/C の検出ロジック自体は素直な AST 判定）を fast path にし、
  Group B の複雑な層/シームルールだけ ESLint に残す案Bと、案Cの「12個完全移植」の中間案も存在する。
  ただしユーザー方針は案C（実装変更可）。

## 次の具体ステップ（未着手・要承認）

1. `npx oxlint` を dev 依存に入れず、現行設定を `@oxlint/migrate` で `.oxlintrc.json` に変換して
   「12個中どこまでクレート/プラグインでカバーできるか」を機械的に差分。特に getScope/getAncestors の再現度。
2. 再現度の結果で Group A（スコープ非依存寄り）から移植 PoC。
3. 移植したルールを oxlint の RuleTester 相当（または vitest 上で oxlint JS プラグインを直接呼ぶ）で検証。
4. `eslint`, `@typescript-eslint/*`, `eslint-plugin-*` を撤去し、`typescript` を 7 に。
   `type-check` は tsc ではなく tsgo（TS7 native）へ。`typedoc` の TS7 peer 未対応は別途評価。