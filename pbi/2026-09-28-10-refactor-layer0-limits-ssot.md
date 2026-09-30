# PBI: Layer 0 cap 定数の SSOT 化

## ユーザーストーリー

保守者として、Layer 0 の cap 定数を `src/utils/limits.ts` に集約したい。なぜなら `src/messaging/limits.ts` が自ファイル内で `@layer 0` を自称しながら `src/utils` 外に配置され、layer lint に穴があるため Layer 0 からの違反 import が見逃されているからだ。

## ビジネス価値

- 自己申告の layer 注釈と物理配置の不一致を解消し、Layer 0 の定義（`src/utils` 配下の純粋モジュール）を単一の基準に戻す。
- layer lint の未分類バイパス（Layer 0 ファイルから `src/messaging/*` への import が検査対象にすらならない）を塞ぎ、同一の穴が再発しないようにする。
- background の pipeline が ingress validator モジュールに依存している逆方向の依存を解消する。現状は 4 つの cap 定数を取得するためだけに 321 行の background モジュールが transitive に引き込まれる。
- `QUERY_CAPS` の re-export kludge（実質的には文脈依存の誤り）と、その根拠を説明するコメントの driftを解消する。
- PBI `2026-09-28-14`（messaging 逆辺解消）が扱わない定数領域を先に片付けることで、14 の対象範囲を messaging の実行時依存に限定する。

## 優先度（refactor / 順位 10 / 17 / RICEスコア 5.3（Reach=4 / Impact=2 / Confidence=100% / Effort=1.5 SP））

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: Layer 0 の cap 定数が単一モジュールに集約されている
  Given messaging 領域の cap 定数が messaging 配下のモジュールから複数ファイル（production 23 と test）に import されている
  And 4 つの validator cap 定数が messaging の validators モジュールから background の pipeline で取得されている
  When cap 定数の配置と import を確認する
  Then すべての cap 定数が Layer 0 の utils 配下モジュールに定義されている
  And 旧パスからの import は移行済みの新規 import に置き換わっている
  And 定数の値、名前、export の形は変更されていない

Scenario: Layer 0 から messaging への違反 import が lint で検出される
  Given Layer 0 として登録された utils 配下のモジュールが messaging 配下のモジュールを import する
  When リポジトリ全体で lint を実行する
  Then その import が error として報告され、allowlist のない変更は CI を通過しない
  And `allow` オプションで明示された例外だけが通る

Scenario: メッセージ契約と値が変わらない
  Given 本 PBI の適用前後で同じ extent 検証メッセージと row cap を持つ
  When 受信メッセージの検証を実行する
  Then 検証結果と表示メッセージが同一である
  And 保持される行数とバイト数の制限値が同一である
```

## 受け入れ基準（4-8件）

- [x] Layer 0 に `src/utils/limits.ts` を新設し、`src/messaging/limits.ts` の純定数部を移設している。定数の値・名前・export 形状は不変である。
- [x] 旧パス `src/messaging/limits.ts` は移行中のみ value-preserving な re-export shim（`export * from '../utils/limits.js'`）とし、全消費ファイル（production と test。`grep -rln "messaging/limits" src` で列挙）を新規パスへ更新したうえで shim を削除している。
- [x] `src/messaging/validators.ts` の 4 cap 定数（`MAX_BYTE_STAT_BYTES` / `MAX_CLEANSED_ELEMENTS` / `MAX_CLEANSED_REASON_CHARS` / `MAX_CLEANSED_REASONS`）と `VALIDATOR_LIMITS` が `src/utils/limits.ts` へ統合され、`src/background/pipeline/mappers/commonStorageFields.ts` が `utils/limits` を直参照している。
- [x] `src/offscreen/queryPlan.ts` の `export const QUERY_CAPS` re-export を廃止し、`QUERY_CAPS` の全消費ファイルが `utils/limits` を直接 import している。kludge の根拠コメント（`QUERY_CAPS` 直上の「OPFS worker cannot import messaging」）が削除されている。
- [x] `src/utils/crypto/envelope.ts` が `messaging/limits` を import している Layer 0 → messaging の逆辺が解消され、`dev-docs/LAYERS.md` の Layer 0 コードブロックと `eslint/rules/utils-layer-boundary.mjs` の `LAYER0_FILES` に `src/utils/limits.ts` が登録され、`npm run lint:layers-docs` が成功する。
- [x] 移設後の `src/utils/limits.ts` に、drift した説明コメント（「Layer 0 modules can't import messaging → re-declare locally」）が残っていない。
- [x] layer lint の Layer 0 分岐（`LAYER0_FILES` の各ファイル）が「`src/utils/` 外への static import（`import type` を除く）は error（`allow` オプションの指定例外を除く）」を報告し、rule test を追加している。
- [x] `npm run validate` が成功し、既存のビルド・テスト・メッセージ契約・ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 受信 extent 検証と row cap を持つ実メッセージの往復を観測点とし、検証結果と表示メッセージが同一であることを Outside-In で確認する。
- ダッシュボードの履歴一覧・archive 一覧の表示件数・バイト制限が同一であることを確認する（定数値が変わっていないことの外側からの確認）。
- 新規のユーザー機能は追加しない。

### 統合テスト

- 移行後の import 経路を検証する: 全消費ファイルが `utils/limits` を import している、background pipeline が messaging を経由せずに cap 値を取得している、offscreen が `utils/limits` を直接 import している。
- messaging の型モジュールが runtime で background の messageTypes を読む経路が、cap 取得のために background モジュールを引き込まないことを確認する。
- shim からの re-export が同値の値を返すこと（value-preserving）を検証する。

### 単体テスト

- layer lint rule test に「Layer 0 ファイルが `src/messaging/*` を import すると error（1 件のみ）」「`allow` 指定があれば通過」「`import type` は通過」「Layer 0 が `src/utils/` 配下の別ファイルを import しても通過」を追加する。rule test は `createRepeatSafeRuleTester` を通し、`--repeats` で再実行しても green であること。
- 「docs と実装の同期を機械検査するテスト」（例: poll 間隔規則の検査）が定数の所在を pin していないか、実装冒頭で確認する。pin している場合は新配置へ更新する。
- 移設した定数について、export 名と値が保存されていることと、意図しない削除が発生していないことを検証する。
- 実時間待ち sleep を含まない。

## 実装ガイド(低コストモデル向け)

この節だけで実装できるように書いてある。行番号は使わず、関数名・定数名・短い引用で位置を示す。09-30 ラウンドの PBI（08 / 09 / 06 / 10 / 11）が `src/utils/storage/*` / `src/utils/crypto/*` / dashboard を編集済みである前提で、着手時に下の grep で現状を確認する。

### 作業ルール(固定)

- ファイルは Read ツールの offset / limit で読む。`sed` / `awk` / `head` / `tail` / `cat` は使わない。検索は `grep -n`。
- コードとコード内コメントは英語。コメントは非自明な WHY のみ。経緯・PBI 番号・変更履歴は書かない（既存コメントを触るときも PBI 番号を消す）。
- production code で `any` / `unknown` を使わない。ESM の import は `.js` で終える。
- 固定時間の待ち（`setTimeout` / `sleep`）や retry 回数の引き上げで test を通さない。awaited promise か `testDir/waitPolicy.ts` の `waitForMock` を使う。`vi.useFakeTimers()` を既定オプションで呼ばない。
- CRLF のファイルは CRLF を保つ。編集前に `file <path>` で確認する。
- tool 呼び出しが permission で拒否されたら、回避せず止めて報告する。

### 1. 前提と着手前チェック

すべて期待どおりでなければ止まり、差分を報告する（推測で進めない）。

```bash
ls src/utils/limits.ts                                   # 期待: No such file
grep -c "^export const" src/messaging/limits.ts          # 期待: 36
grep -n "MAX_KDF_ITERATIONS\|MIN_KDF_ITERATIONS\|assertValidStoredKdfIterations" src/utils/crypto/primitives.ts | head -3   # 期待: 1 件以上（09-30 が反映済み）
grep -n "from '../../messaging/limits.js'" src/utils/crypto/envelope.ts   # 期待: 1 件（MAX_ENVELOPE_BASE64_LENGTH）
grep -n "MAX_BYTE_STAT_BYTES = \|MAX_CLEANSED_ELEMENTS = \|MAX_CLEANSED_REASON_CHARS = \|MAX_CLEANSED_REASONS = \|export const VALIDATOR_LIMITS" src/messaging/validators.ts   # 期待: 5 件
grep -n "export const QUERY_CAPS" src/offscreen/queryPlan.ts   # 期待: 1 件
grep -rn "vi.mock(.*limits\|vi.mock(.*validators" src testDir   # 期待: 0 件
grep -n "src/messaging/limits.ts" src/messaging/__tests__/limits-drift.test.ts   # 期待: 2 件（EXEMPT と readFileSync）
grep -n "LAYER0_FILES\|src/utils/visitThresholds.ts" eslint/rules/utils-layer-boundary.mjs | head -3
npm run lint:layers-docs                                 # 期待: 成功（着手前に緑であること）
git status --short                                       # 期待: 空
```

不一致時の扱い: 36 でなければ `src/messaging/limits.ts` の export が増減している。Phase 0 の parity テーブルを現状の `export const` に合わせて作り直してから進める。`vi.mock` が 1 件でもあれば、その factory に新しい export 元の全名を足す（「5. 既存テストへの影響」）。

### 2. 変更対象ファイル

作成: `src/utils/limits.ts`、`src/utils/__tests__/limits-parity.test.ts`。
移動（`git mv`）: `src/messaging/__tests__/limits.test.ts` → `src/utils/__tests__/limits.test.ts`、`src/messaging/__tests__/limits-drift.test.ts` → `src/utils/__tests__/limits-drift.test.ts`。
削除: `src/messaging/limits.ts`（Phase 2 の最後）。
編集: `grep -rln "messaging/limits" src` が返す全ファイル、`src/messaging/validators.ts`、`src/background/pipeline/mappers/commonStorageFields.ts`、`src/offscreen/queryPlan.ts` と `QUERY_CAPS` の消費ファイル（Phase 4 で列挙）、`eslint/rules/utils-layer-boundary.mjs`、`eslint/__tests__/utils-layer-boundary.test.ts`、`dev-docs/LAYERS.md`、`dev-docs/DESIGN_SPECIFICATIONS.md`（`src/messaging/limits.ts` を書いた 2 箇所）。
触らない: `src/messaging/types.ts`（`messageTypes` 参照）、`src/utils/auditLog.ts`（messaging への再 export シム。未分類で lint 対象外）、`src/utils/commonTypes.ts`（type-only import）、`CHANGELOG.md`、他の PBI ファイル。
登録先: `LAYER0_FILES`（`eslint/rules/utils-layer-boundary.mjs`）と `dev-docs/LAYERS.md` の「Layer 0」コードブロックの両方に `src/utils/limits.ts` を足す。`scripts/lint-layers-docs.mjs` は 2 つの一致を検査するので片方だけだと失敗する。`manifest.json` はリポジトリに無く（WXT 生成）、`wxt.config.ts` の `web_accessible_resources` は `content-extractor.js` と `icons/icon48.png` のみなので更新しない。`npm run build` 後に生成 manifest の `web_accessible_resources` が変わっていないことだけ確認する。

### 3. 手順

各 Phase の末尾で「6. 検証コマンド」を通し、緑の状態で 1 コミットにする。

**Phase 0: parity test（テスト先行、コミット 1）**
1. 「4. テスト先行」の `src/utils/__tests__/limits-parity.test.ts` を作る。この時点の import は旧パス。`npx vitest run src/utils/__tests__/limits-parity.test.ts` が緑であることを確認する。

**Phase 1: 新モジュール作成と shim 化（コミット 2）**
2. `src/utils/limits.ts` を作る。中身は `src/messaging/limits.ts` の全 export をそのままコピーする（値・名前・`as const` を変えない）。1 行目の `// @layer 0 — Foundation: pure constants, no dependencies` は残す。ヘッダの `messaging/limits.ts` という名前は `utils/limits.ts` に直す。
3. コピーしたファイル内の 2 つのコメントを直す。(a) 「Round 5 ... A consumer that cannot import messaging (Layer 0 modules) re-declares locally and is caught by the drift guard.」は誤りなので、見出し全体を `// Caps absorbed from per-module literals; each value keeps its original number.` の 1 行に置き換える。(b) `QUERY_CAPS` 直上の「`queryPlan.ts` re-exports this object for the OPFS worker boundary, which cannot import the messaging layer directly.」の段落を削除する（`Both caps live next to MAX_QUERY_LIMIT ...` の文は残す）。
4. `src/messaging/limits.ts` の全内容を次の 1 行に置き換える。

```ts
export * from '../utils/limits.js';
```

5. `LAYER0_FILES` の末尾（`'src/utils/visitThresholds.ts',` の次）に `// Cap registry: dependency-free constants.` と `'src/utils/limits.ts',` を足す。`dev-docs/LAYERS.md` の Layer 0 コードブロックの `src/utils/visitThresholds.ts` の次にも `src/utils/limits.ts` を足す。

**Phase 2: 消費側の移行と shim 削除（コミット 3）**
6. `grep -rn "messaging/limits" src` の各 import を新パスへ機械的に書き換える。相対 path の深さに注意する（例: `src/offscreen/x.ts` の `'../messaging/limits.js'` → `'../utils/limits.js'`、`src/utils/x.ts` の `'../messaging/limits.js'` → `'./limits.js'`、`src/utils/crypto/envelope.ts` の `'../../messaging/limits.js'` → `'../limits.js'`、`src/utils/storage/quota.ts` は `'../limits.js'`、`src/background/handlers/dashboardSqlite/deps.ts` の `export { ... } from` も同様）。import 名の別名（`MAX_ERROR_BODY_SIZE as MAX_ERROR_BODY_LIMIT` 等）は変えない。
7. `src/messaging/validators.ts` の `from './limits.js'` を `from '../utils/limits.js'` にする。
8. コメントだけの言及（`systemHandlers.ts`、`sqliteEngineHost.ts`、`importPipeline.ts`、`obsidianConfigValidator.ts`、`quota.ts`、`importLogsService.ts`、`computeLimits.ts`、`queryPlan.ts` 冒頭）は `utils/limits.ts` を指す形に直し、PBI 番号は消す。`computeLimits.ts` の「Layer direction」段落は「`utils/limits.ts` は同じ utils 内の Layer 0 定数モジュール」という内容に書き換える。
9. test を移す。`git mv` で `limits.test.ts` / `limits-drift.test.ts` を `src/utils/__tests__/` へ移し、内部 import を直す（`'../limits.js'` はそのまま有効、`'../validators.js'` → `'../../messaging/validators.js'`、`'../../utils/computeLimits.js'` → `'../computeLimits.js'`、`'../../background/handlers/...'` は深さが同じなので不変）。`limits-drift.test.ts` の `EXEMPT` の `'src/messaging/limits.ts'` と `readFileSync(... 'src', 'messaging', 'limits.ts')` を `'src/utils/limits.ts'` / `'src', 'utils', 'limits.ts'` にする。他 test の `messaging/limits.js` import（`readOnlyProjection-pins` / `planAuditLog` / `filterConditionSsot` / `queryPlanner` / `validators-limits`）も新パスへ。
10. `grep -rn "messaging/limits" src eslint testDir dev-docs` が、`eslint/__tests__/utils-layer-boundary.test.ts`（Phase 5 で直す）と `dev-docs/DESIGN_SPECIFICATIONS.md`（Phase 5 で直す）以外 0 件になったら `git rm src/messaging/limits.ts`。`limits-parity.test.ts` の import を `'../limits.js'` に直す（テーブルは触らない）。

**Phase 3: validators の 4 定数と VALIDATOR_LIMITS の移設（コミット 4）**
11. `validators.ts` の「ByteStats bounds ... `export const MAX_BYTE_STAT_BYTES` ... `MAX_CLEANSED_REASONS`」のコメントと 4 定数、および「Payload size caps ... `export const VALIDATOR_LIMITS = {...} as const;`」のコメントとオブジェクトを、`src/utils/limits.ts` の末尾（`MAX_ARCHIVE_QUERY_LIMIT` の後ろ）へ、コメントごと移す。`VALIDATOR_LIMITS` は先頭の定数を shorthand で参照するので、必ず全定数の宣言より後ろに置く。
12. `validators.ts` の import を、実際に使う名前だけ（`MAX_BYTE_STAT_BYTES` / `MAX_CLEANSED_ELEMENTS` / `MAX_CLEANSED_REASON_CHARS` / `MAX_CLEANSED_REASONS`。`grep -n VALIDATOR_LIMITS src/messaging/validators.ts` が 0 件なら import 不要）`'../utils/limits.js'` から足す。`validators.ts` から re-export はしない。
13. 消費側を更新する: `commonStorageFields.ts` は `'../../../messaging/validators.js'` → `'../../../utils/limits.js'`。test は `commonStorageFields-clamp.test.ts`（→ `'../../../../utils/limits.js'`）、`validVisitByteStats.test.ts`、`validators-limits.test.ts`、`validators-shared-checks-parity.test.ts`、`src/utils/__tests__/limits.test.ts` で、4 定数と `VALIDATOR_LIMITS` の import を `validators.js` から `utils/limits.js` へ移す（`ValidVisitValidator` 等は `validators.js` のまま）。
14. `limits-parity.test.ts` の 4 定数と `VALIDATOR_LIMITS` の取得元（`validatorsModule`）を `limitsModule` に一本化する（テーブルは触らない）。

**Phase 4: QUERY_CAPS の re-export 廃止（コミット 5）**
15. `queryPlan.ts` の `import { QUERY_CAPS as QUERY_CAPS_SOURCE } from '../utils/limits.js';` を `import { QUERY_CAPS } from '../utils/limits.js';` にし、`selectReadCap` 内の `QUERY_CAPS_SOURCE` を `QUERY_CAPS` にし、コメント付きの `export const QUERY_CAPS: typeof QUERY_CAPS_SOURCE = QUERY_CAPS_SOURCE;` を削除する。
16. `grep -rn "QUERY_CAPS.*queryPlan\|queryPlan.*QUERY_CAPS" src` で見つかる消費側（`IdbVfsBackend.ts` / `storageFallback.ts` / `opfsWorker/crudHandlers.ts` / `background/__tests__/fakes/inMemoryTransport.ts` と test の `queryPlanClamp` / `queryPlan.tagClusterRegression` / `query-backends-parametric` / `inMemoryTransport.test`）は、`QUERY_CAPS` を import リストから外し `utils/limits.js` から別 import する。`queryPlanner.test.ts` の「QUERY_CAPS is a single definition shared with the planner」は `plan.QUERY_CAPS` が無くなるため、`expect(plan).not.toHaveProperty('QUERY_CAPS')` に置き換える。
17. `grep -rn "QUERY_CAPS" src` の import 元がすべて `utils/limits` であることを確認する。

**Phase 5: lint 強化とドキュメント（コミット 6）**
18. `utils-layer-boundary.mjs` の `create()` で、`utilsPrefix` の直後に `const utilsPrefixResolved = utilsPrefix.replace(/^\/+/, '');` を足す（`resolveImport` は先頭の `/` を落とすため、既存の `resolved.startsWith(utilsPrefix)` はそのまま流用できない）。
19. `checkStaticImport` の `if (inLayer0) {` の直後（`const layer1Hit` の前）に次を挿入する。`checkReverseEdge` が sibling 層を既に報告するので、二重報告を避けるために `FORBIDDEN_TARGET_LAYERS` は除く。

```js
if (!resolved.startsWith(utilsPrefixResolved)) {
  if (!matchesAny(resolved, FORBIDDEN_TARGET_LAYERS) && !isAllowlisted(allow, filename, resolved)) {
    context.report({ node, messageId: 'layer0ForbiddenImport', data: { target: source, targetLayer: 'outside src/utils/' } });
  }
  return;
}
```

20. `eslint/__tests__/utils-layer-boundary.test.ts` を直す。valid の「Layer 0 importing messaging constants (outside utils, v1 out of scope)」を削除し、次を足す。valid: `import { X } from '../../messaging/limits.js';`（`/repo/src/utils/crypto/envelope.ts`、`options: [{ allow: [{ from: 'src/utils/crypto/envelope.ts', to: 'src/messaging/limits' }] }]`）、`import type { T } from '../messaging/types.js';`（`LAYER0_FILE`）、`import { x } from './crypto/primitives.js';`（`LAYER0_FILE`）。invalid: `import { MAX } from '../messaging/limits.js';`（`LAYER0_FILE`、`errors: [{ messageId: 'layer0ForbiddenImport' }]`）、`import { x } from '../background/foo.js';`（`LAYER0_FILE`、`errors: [{ messageId: 'utilsReverseEdge' }]` の 1 件のみ）。
21. `dev-docs/LAYERS.md` の「検査範囲」の Layer 0 箇条に「`src/utils/` 外への静的 import の禁止（`import type` と `allow` 指定を除く）」を足す。`dev-docs/DESIGN_SPECIFICATIONS.md` の 2 箇所（`src/messaging/limits.ts`）を `src/utils/limits.ts` に直す。
22. 最終確認: `grep -rn "messaging/limits" src eslint testDir dev-docs scripts` が 0 件。

### 4. テスト先行

ファイル: `src/utils/__tests__/limits-parity.test.ts`（Phase 0 で作り、Phase 2・3 で import 元だけ更新する）。構成: `import * as limitsModule from '../../messaging/limits.js';` と `import * as validatorsModule from '../../messaging/validators.js';`。`const surface = { ...validatorsModule, ...limitsModule } as Record<string, object | number>;`（test 内の型付けは許容）。ケース 3 つ。

1. `it.each(Object.entries(EXPECTED))('%s keeps its value', (name, value) => expect(surface[name]).toBe(value))`: 下の値をそのまま `EXPECTED` にする。
2. `it('exposes every expected export name')`: `Object.keys(EXPECTED)` の各名が `name in surface`。加えて `EXPECTED_LIMITS_EXPORT_COUNT`（Phase 0 では limits だけの 36、Phase 3 以降は 41）と `Object.keys(limitsModule).length` の一致を pin する。
3. `it('QUERY_CAPS and VALIDATOR_LIMITS keep their shape')`: `expect(surface.QUERY_CAPS).toEqual({ fts: 100000, plain: 10000 })`、`expect(Object.keys(surface.VALIDATOR_LIMITS).sort())` が 13 キー（`MAX_CONTENT_LENGTH` `MAX_TITLE_LENGTH` `MAX_SEARCH_QUERY_LENGTH` `MAX_IMPORT_ROWS` `MAX_IMPORT_BYTES` `MAX_RESTORE_DB_BYTES` `MAX_ARCHIVE_EXPORT_CHUNK_BYTES` `MAX_APPEND_IDS` `MAX_ARCHIVE_QUERY_LIMIT` `MAX_BYTE_STAT_BYTES` `MAX_CLEANSED_ELEMENTS` `MAX_CLEANSED_REASON_CHARS` `MAX_CLEANSED_REASONS` の昇順）と一致。`VALIDATOR_LIMITS[name]` が `EXPECTED[name]` と一致。

`EXPECTED`（数値は現在の code の評価値。`QUERY_CAPS` / `VALIDATOR_LIMITS` は別ケース）:

| name | value |
|---|---|
| MAX_CONTENT_LENGTH | 1000000 |
| MAX_TITLE_LENGTH | 500 |
| MAX_SEARCH_QUERY_LENGTH | 1000 |
| MAX_IMPORT_ROWS | 1000 |
| MAX_IMPORT_BYTES | 2000000 |
| MAX_RESTORE_DB_BYTES | 10000000 |
| MAX_ARCHIVE_EXPORT_CHUNK_BYTES | 8388608 |
| MAX_APPEND_IDS | 100 |
| MAX_RESTORE_BASE64_BYTES | 157286400 |
| AUDIT_CAP_OPFS | 1000 |
| AUDIT_CAP_IDB | 100000 |
| MAX_QUERY_LIMIT | 100000 |
| MAX_LOG_FORWARD_MESSAGE_CHARS | 65536 |
| MAX_LOG_FORWARD_DETAILS_KEYS | 64 |
| MAX_LOG_FORWARD_SERIALIZED_CHARS | 262144 |
| MAX_RECORD_SIZE | 65536 |
| MAX_PII_INPUT_SIZE | 65536 |
| MAX_PII_OUTPUT_SIZE | 131072 |
| MAX_TOKENS_PER_CALL | 10000000 |
| MAX_ENVELOPE_CIPHERTEXT_LENGTH | 67108864 |
| MAX_ERROR_BODY_SIZE | 1048576 |
| MAX_IMPORT_TEXT_BYTES | 10485760 |
| MAX_PAYLOAD_STRING_BYTES | 1048576 |
| MAX_BATCH_TOTAL_BYTES | 20971520 |
| MAX_PAYLOAD_TOTAL_BYTES | 20971520 |
| MAX_FILTER_LIST_SIZE | 10485760 |
| MAX_BODY_SIZE | 10485760 |
| DEFAULT_IMPORT_SIZE_CAP_BYTES | 10485760 |
| MAX_ENVELOPE_BASE64_LENGTH | 10485760 |
| MAX_AI_HTTP_RESPONSE_BYTES | 10485760 |
| STORAGE_QUOTA_BYTES | 10485760 |
| IMPORT_TOTAL_ROW_CAP | 100000 |
| MAX_SUMMARY_LENGTH | 100000 |
| MAX_QUERY_IDS | 200 |
| MAX_ARCHIVE_QUERY_LIMIT | 500 |
| MAX_BYTE_STAT_BYTES | 16777216 |
| MAX_CLEANSED_ELEMENTS | 1000000 |
| MAX_CLEANSED_REASON_CHARS | 128 |
| MAX_CLEANSED_REASONS | 64 |

Phase 0 では上表どおりに書いた test が緑になることを確かめる。赤い行があれば、表ではなく PBI の前提（値の転記ミス）を疑い、`src/messaging/limits.ts` を Read して表を直す。再 export 面の pin は既存 test が担う（`deps.ts` の 3 定数 = `limits.test.ts`、`queryPlan` と limits の `QUERY_CAPS` 同一性 = `queryPlanner.test.ts`、`sqliteEngineHost` の `MAX_QUERY_LIMIT`、`quota.ts` の `STORAGE_QUOTA_BYTES`）。Phase 0 で次の 2 行を parity test のケース 4 として足す: `import { MAX_QUERY_LIMIT as ENGINE_LIMIT } from '../../offscreen/sqliteEngineHost.js'` と `import { STORAGE_QUOTA_BYTES as QUOTA } from '../storage/quota.js'` がそれぞれ `100000` / `10485760` と一致する（import が重い場合は `await import()`）。この 2 つの import は Phase 中に変更しない。

### 5. 既存テストへの影響

- `vi.mock` で limits / validators を差し替えている test は現在 0 件。増えていたら factory に新しい import 元の全 export（`QUERY_CAPS`、4 定数、`VALIDATOR_LIMITS`）を足す。足さないと `No "X" export is defined on the mock` で落ちる。
- `envelope.ts` は import 行 1 つの変更だけである。`crypto.subtle` を空の `vi.fn()` で差し替えている test は、空文字列を返して別の理由で落ちることがあるため、`src/utils/crypto` 配下の test が Phase 2 後も緑であることを個別に確認し、赤ければ import 変更ではなく既存の stub 不足を疑って止めて報告する。
- 適応が必要な test: `src/messaging/__tests__/{limits,limits-drift,validators-limits,validators-shared-checks-parity,validVisitByteStats}.test.ts`、`src/background/pipeline/mappers/__tests__/commonStorageFields-clamp.test.ts`、`src/background/handlers/dashboardSqlite/__tests__/readOnlyProjection-pins.test.ts`、`src/offscreen/__tests__/{planAuditLog,filterConditionSsot,queryPlanner,queryPlanClamp,queryPlan.tagClusterRegression,query-backends-parametric}.test.ts`、`src/background/__tests__/fakes/inMemoryTransport{,.test}.ts`、`eslint/__tests__/utils-layer-boundary.test.ts`。

### 6. 検証コマンド(順番どおり)

```bash
npm run type-check
npm run lint                     # 0 errors
npm run lint:layers-docs
npx vitest run eslint/__tests__ --repeats=20    # Phase 5 のみ必須（他 Phase は 1 回実行で可）
npx vitest run src/utils src/dashboard src/background src/popup src/offscreen src/messaging
npx vitest run src/utils/__tests__/limits-parity.test.ts --repeats=20
npm run build
```

Phase 5 完了時にだけ `npm run validate` も通す。`npm run lint` が新たに `layer0ForbiddenImport` を返したら、それは `LAYER0_FILES` の別ファイルが `src/utils/` 外を import している実例なので、消さずに止めて報告する。

### 7. 落とし穴

- `resolveImport` は先頭の `/` を落とす。`resolved.startsWith(utilsPrefix)` を新しい判定にそのまま使うと常に false になり全 import が error になる。手順 18 の `utilsPrefixResolved` を使う。
- `utils/limits.ts` を `LAYER0_FILES` と LAYERS.md の片方にしか足さないと `lint:layers-docs` が落ちる。
- `export *` の shim は値の同一性（`QUERY_CAPS` の参照同一）を保つ。`export const X = ...` で再宣言すると同一性が壊れる。
- 定数の `as const` の付け替えや object 凍結、順序の変更、`VALIDATOR_LIMITS` のキー追加は契約変更になる。コピーは機械的に行う。
- `validators.ts` から re-export を残さない（残すと shim が増える）。
- `queryPlan` の `QUERY_CAPS` を消したあと、型 `typeof QUERY_CAPS`（`buildQuerySpec` の `opts.caps`）が同じファイル内で解決できることを `type-check` で確認する。
- `limits-drift.test.ts` は `src` を走査して cap の数値代入を探す。新しい `src/utils/limits.ts` を `EXEMPT` に入れ忘れると自己検出で赤になる。
- 別 Phase の変更を 1 コミットにまとめない。赤になったら直前の Phase に戻す。

### 8. コミットとアーカイブ手順

zsh では path 一覧を配列に入れる。

```bash
# (a) 受け入れ基準と DoD の `[ ]` を `[x]` にする（「コードレビュー完了」の項目があれば未チェックのまま）
# (b)(c) Phase ごとに、変更したファイルを明示して add / commit する。`git add -A` / `git add .` は使わない
files=(src/utils/__tests__/limits-parity.test.ts)   # Phase ごとに実際の変更 path を並べる
git add -- "${files[@]}"
git commit -m "test(utils): cap 定数の値と export 面を pin する parity test を追加する" -m "cap 定数を Layer 0 へ移す前に、値・名前・export 形状を固定して移設が挙動を変えないことを機械的に示すため。" -- "${files[@]}"
```

各 Phase の type は `refactor`（Phase 0 のみ `test`）。本文には WHY（Layer 0 の定義と物理配置を一致させ、逆向き依存と lint の抜けを解消する）を書く。

```bash
# (d) 全 Phase 完了後、PBI 自体を archive する
git add pbi/2026-09-28-10-refactor-layer0-limits-ssot.md
git mv pbi/2026-09-28-10-refactor-layer0-limits-ssot.md dev-docs/archived/pbi/
paths=(pbi/2026-09-28-10-refactor-layer0-limits-ssot.md dev-docs/archived/pbi/2026-09-28-10-refactor-layer0-limits-ssot.md)
git commit -m "docs(pbi): 09-28 PBI 10(Layer 0 cap 定数の SSOT 化)をアーカイブする" -- "${paths[@]}"
```

### 9. 完了条件

- `grep -rn "messaging/limits" src eslint testDir dev-docs scripts` が 0 件で、`src/messaging/limits.ts` が存在しない。
- `limits-parity.test.ts` が Phase 0 の表のまま緑（`--repeats=20`）。
- 「6. 検証コマンド」がすべて成功し、`npm run validate` も成功している。
- `LAYER0_FILES` と LAYERS.md の両方に `src/utils/limits.ts` があり、Layer 0 が `src/utils/` 外を import すると lint が error になる。
- 受け入れ基準と DoD が（コードレビュー完了を除いて）チェック済みで、PBI が `dev-docs/archived/pbi/` へ移動されている。

## 見積もり（**1.5 SP** + 内訳）

- `src/utils/limits.ts` の新設と messaging 側純定数の移設（shim 含む）: 0.5 SP
- 21 消費ファイルと `commonStorageFields.ts:12-17`、`queryPlan.ts:254` の import 更新: 0.4 SP
- `validators.ts:58-61` と `VALIDATOR_LIMITS`（`validators.ts:68-95`）の統合と drift コメントの訂正: 0.25 SP
- layer lint の Layer 0 分岐強化（判定追加・allowlist 例外・rule test）: 0.35 SP
- 合計: **1.5 SP**

## 技術的考慮事項（file:line 付き）

- `src/messaging/limits.ts` の 1 行目は `// @layer 0 — Foundation: pure constants, no dependencies` と自己申告しているが、実態は import 0 の純定数であり、`LAYERS.md` の Layer 0 定義（`src/utils/` 配下の純粋モジュール）から外れる。
- 消費は production 23 ファイル（`src/messaging/validators.ts` の `./limits.js` を含む）と test 6 ファイル前後（着手時に `grep -rln "messaging/limits" src` で確定する）。うち `src/utils/crypto/envelope.ts` は `LAYER0_FILES`（`eslint/rules/utils-layer-boundary.mjs`）と `dev-docs/LAYERS.md` の Layer 0 ブロックに載るファイルで、`messaging/limits` を import しており Layer 0 → messaging の逆辺になっている。
- lint が見逃す構造: `checkStaticImport` の `inLayer0` 分岐は `LAYER1_FILES` / `LAYER2_MODULES` / `BARREL_MODULES` との照合しか行わない。`checkReverseEdge` の `FORBIDDEN_TARGET_LAYERS` は `src/messaging/` を意図的に含まない（`utils/auditLog.ts` の再 export シムが指すため）。結果として Layer 0 ファイルから `src/messaging/*` への static import はどのチェックにも掛からない。
- コメント drift: `src/messaging/limits.ts` の「Round 5」見出しコメントは「Layer 0 modules can't import messaging → re-declare locally and get caught by drift guard」と主張するが、実際は `envelope.ts` が import している。drift guard はこのケースを検出していない。
- 逆方向依存の 4 定数: `src/background/pipeline/mappers/commonStorageFields.ts` が `MAX_BYTE_STAT_BYTES` / `MAX_CLEANSED_ELEMENTS` / `MAX_CLEANSED_REASON_CHARS` / `MAX_CLEANSED_REASONS` を `messaging/validators.ts` から取得する（定義元は `validators.ts` の `VALIDATOR_LIMITS` 直前）。pipeline 配下で validators を runtime import するのはこの 1 ファイルのみ。
- `src/messaging/types.ts` が runtime で `../background/messageTypes.js`（321 行）を読むため、4 定数の取得のためにそのモジュールが transitive に引き込まれる。
- 方針の既存判断: `validators.ts` 自身も 9 つの上限を `limits.ts` から import 済みで、4 定数と `VALIDATOR_LIMITS` だけが `validators.ts` に残っている。
- re-export kludge: `src/messaging/limits.ts` の `QUERY_CAPS` 直上のコメントは `QUERY_CAPS` の re-export 理由を「OPFS worker cannot import messaging directly」としているが、`messaging/limits` は純定数で文脈依存がない。`src/offscreen/queryPlan.ts` の `export const QUERY_CAPS` がその re-export で、`IdbVfsBackend.ts` / `storageFallback.ts` / `opfsWorker/crudHandlers.ts` / `background/__tests__/fakes/inMemoryTransport.ts` と複数の test がそれ経由で読んでいる。
- 依存関係: PBI `2026-09-28-14`（messaging 逆辺解消）は `validators.ts` と limits 領域が重なるため本 PBI に依存し、10 → 14 の順で進める。
- 移行時は `utils/limits.ts` を `eslint/rules/utils-layer-boundary.mjs` の `LAYER0_FILES` と `dev-docs/LAYERS.md` の Layer 0 ブロックの両方に追記する（片方だけだと `lint:layers-docs` が失敗する）。登録漏れると新しい SSOT が検査対象外になる。
- 既存運用: `src/messaging/__tests__/limits-drift.test.ts` が `src/messaging/limits.ts` の所在を path 文字列で pin している（`EXEMPT` と `readFileSync`）。移設時に更新が必須である。

## 実装者向け注記

### 現状コードの確認

- `src/utils/limits.ts` は未作成である。新設対象である。`manifest.json` はリポジトリに無く `wxt.config.ts` が生成するため、`web_accessible_resources`（`content-extractor.js` と `icons/icon48.png` のみ）の更新は不要である。
- `src/messaging/limits.ts` は header で `@layer 0` を宣言し、`MAX_*` / `AUDIT_CAP_*` / `QUERY_CAPS` 等の純定数を持つ。import は 0 である。
- 消費は production 23 ファイルと test で、`envelope.ts` を含む Layer 0 側からの import が 1 件ある。
- `utils-layer-boundary.mjs` の Layer 0 分岐は LAYER1 / LAYER2 / BARREL のみを検査し、`checkReverseEdge` も messaging を対象外にしているため、`src/messaging/*` への import は allowlist なしで通過する。
- `validators.ts` の 4 定数は `commonStorageFields.ts` だけが background 側から参照し、他の 9 個は既に `limits.ts` へ寄っている。
- `messaging/types.ts` の `messageTypes` 参照は 4 定数取得と無関係だが、同じ import グラフ上にあるため、cap 取得経路に紛れ込まないことを確認する。

### 実装手順

`## 実装ガイド(低コストモデル向け)` の「手順」に従う。

### 落とし穴

- shim 残置は barrel 再導入と同じ姿になる。shim は Phase 2 の中で作って消す。
- 機械検査が定数の所在を pin していると、移設直後にそのテストが赤になる。「expected される diff」に見せないよう、意図的な更新として扱う。
- `utils/limits.ts` を Layer 0 登録リストに追記し忘れると、新しい SSOT が検査対象外になり、本 PBI の目的が失われる。
- lint の Layer 0 判定を「`src/messaging/*` を禁止」に限定すると、他の新 Layer（popup、offscreen、content など）への誤検知を生む。`src/utils/` 外という一般的な規則として実装する。
- 4 定数を `utils/limits` へ移すと `validators.ts` の責務が曖昧になる（上限定義と検証ロジックの同居）。`VALIDATOR_LIMITS` の集約先は `limits.ts` 側とし、検証ロジックは `validators.ts` に残す。
- `messaging/types.ts` の `messageTypes` 参照と 4 定数取得の依存を 1 本の依存と見なすと、`2026-09-28-14` の領域まで巻き込む。対象を cap 取得の 4 定数に限定する。
- 値・export 形の変更（`as const` の付け替え、object 凍結、`QUERY_CAPS` の形状変更）を「整理」として入れると、メッセージ契約が変わる。移設は値と形の保存だけを許容する。
- eslint rule のテストに単純な `new RuleTester` を使うと、`--repeats` 実行時に緑にならない既知の問題がある。`createRepeatSafeRuleTester` を使う。

## 決定事項

1. cap 定数の正規の配置先を Layer 0 の `src/utils/limits.ts` とする。`src/messaging/limits.ts` の `@layer 0` 自己申告は撤回する。
2. 値は不変とし、定数の追加・削除・命名変更・export 形状の変更を行わない。
3. 旧パスは移行期間のみ re-export shim として残し、全消費ファイルの import 更新後に同じ PBI 内で削除する。
4. `validators.ts` の 4 定数と `VALIDATOR_LIMITS` は「Layer 0 cap を limits に集約する」既存方針に従い `utils/limits.ts` へ統合し、検証ロジックは `validators.ts` に残す。
5. `QUERY_CAPS` の messaging 経由 re-export を廃止し、offscreen は `utils/limits` を直接 import する。kludge の根拠コメントは削除する。
6. layer lint の Layer 0 判定を `src/utils/` 外への static import 禁止として一般化し、例外は `allow` オプションで明示する。
7. `utils/limits.ts` を Layer 0 登録リストへ必ず追加し、登録漏れによる検査対象の抜けを防ぐ。
8. PBI `2026-09-28-14` と対象領域を分離するため、`messaging/types.ts` の `messageTypes` 参照には手を加えない。10 → 14 の順で進める。
9. 機械検査テスト（docs と実装の同期を検査するテスト）が定数所在を pin している場合は、新配置への更新を本 PBI のスコープに含める。

## Definition of Done

- [x] すべての Layer 0 cap 定数が `src/utils/limits.ts` に定義され、値・名前・export 形状が着手前と一致している（parity test で pin）。
- [x] 旧パス `src/messaging/limits` への import が残存しておらず、`src/messaging/limits.ts` 自体が削除されている。
- [x] `commonStorageFields.ts` が `utils/limits` を直参照し、pipeline から messaging validators への runtime 依存が解消されている。`queryPlan.ts` の `QUERY_CAPS` re-export が廃止され、offscreen が `utils/limits` を直接 import している。
- [x] 観測挙動が不変である: cap の値、API 形状、メッセージ契約、検証結果と表示メッセージがすべて本 PBI 前と一致している。
- [x] `src/utils/crypto/envelope.ts` を含む Layer 0 からの messaging import が解消され、LAYERS 文書と lint の Layer 0 登録リストが新配置と一致している。
- [x] layer lint が `src/utils/` 外への Layer 0 static import を error として報告し、rule test（allow なし / allow あり / type-only / utils 内 import）が `createRepeatSafeRuleTester` 経由で green である。
- [x] drift したコメント（「Layer 0 は messaging を import できない」主張、`QUERY_CAPS` の kludge 理由）が `src/utils/limits.ts` に残っておらず、`limits-drift.test.ts` の所在 pin が新配置へ更新されている。
- [x] 共通化と同時に定数の追加・export 形状の変更・lint オプションの DSL 化を行っていない（YAGNI 遵守）。
- [x] `npm run validate` が成功し、既存ビルド・テスト・メッセージ契約・ユーザー観測挙動に回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
