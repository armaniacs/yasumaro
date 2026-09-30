# PBI: messaging 層の background への runtime edge 解消

## ユーザーストーリー

保守者として、中立 wire 層 `src/messaging/` を background への runtime 依存ゼロにしたい。なぜなら 2 本の static runtime edge と `CURRENT_PROTOCOL_VERSION` の 2 経路が drift の火種で、閉路も 1 本形成されているからだ。

## ビジネス価値

- 「中立 wire 層」という `src/messaging/` の位置づけを、実際に background へ依存しない構造として成立させる。
- `CURRENT_PROTOCOL_VERSION` の 2 経路（protocol 直参照と messageTypes 経由の re-export）を 1 本に収束させ、プロトコル版の drift を構造的に防ぐ。
- メッセージ種別の定数を messaging へ集約し、popup / dashboard / SessionAlarmService を含む約 14 ファイルの変更で「定数の所在」を単一にする。
- lint で `src/messaging/` から background および utils への runtime import を禁止し、将来の再侵入を機械的に検出できる状態にする。

## 優先度

- 種別: refactor
- 順位: 14 / 17
- RICEスコア: 3.6（Reach=4 / Impact=2 / Confidence=90% / Effort=2 SP）

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: 中立 wire 層から background への runtime edge が 0 件になる
  Given src/messaging/ が runtime 値を background から static import している箇所が 2 件存在する（types.ts と messageTransport.ts）
  And type-only import が 7 箇所存在する
  When メッセージ種別の runtime 定数を src/messaging/ へ移し、import を更新する
  Then src/messaging/ から src/background への runtime import が 0 件になる
  And type-only import は移設対象として扱わない

Scenario: 閉路が解消される
  Given messaging の validator が background の handler 実装を参照する設計上の逆転がある
  When wire 契約としての dashboardSqliteProtocol を messaging 配下へ移す
  Then messaging 内部で wire 契約と handler 実装の向きが正しくなる
  And 観測されるメッセージ契約と subtype 判定の値が不変である

Scenario: CURRENT_PROTOCOL_VERSION の参照経路が 1 本に収束する
  Given protocol.ts を SSOT とする直参照と、messageTypes の re-export 経由の参照が併存している
  When 全ての参照を protocol の直参照へ更新する
  And background/messageTypes.ts を re-export shim に降格する
  Then CURRENT_PROTOCOL_VERSION の参照が protocol 直参照の 1 経路に収束する
  And プロトコル版の値が不変である

Scenario: lint が messaging の runtime 境界を機械的に拒否する
  Given src/messaging/ から background への runtime import を追加する
  When lint を実行する
  Then background への runtime import は @typescript-eslint/no-restricted-imports によって拒否される
  And import type は許容される
```

## 受け入れ基準

- [x] `src/background/messageTypes.ts` から runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）が `src/messaging/` へ移されている。
- [x] `src/background/messageTypes.ts` は re-export shim に降格しており、`ExtensionMessage` union は `import type` のまま移設されていない。
- [x] `src/messaging/` から `src/background/` への runtime import が 0 件になっている（type-only の 7 文と動的 import 2 件は対象外）。
- [x] `src/background/handlers/dashboardSqliteProtocol.ts` が messaging 配下へ移され、`messaging/sqliteMessages.ts` および `messaging/sqliteOperationSecurity.ts` と同列の wire 契約として配置されている。
- [x] `CURRENT_PROTOCOL_VERSION` の参照が `src/messaging/protocol.ts` の直参照 1 経路に収束している。
- [x] `src/messaging/` 配下から `src/background` への runtime import を拒否する `@typescript-eslint/no-restricted-imports`（`allowTypeImports: true`）設定が `files: ['src/messaging/**/*.ts']` で追加されている（`eslint/rules/utils-layer-boundary.mjs` は使わない。utils への runtime import は正当なため禁止しない）。
- [x] 定数値、メッセージ契約、プロトコルバージョンの値が変更されていない。
- [x] `npm run validate` が成功し、既存のビルド・テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「ダッシュボードと service worker のメッセージングが従来どおり往復する」という観測点を確認する。
- 新しいユーザー機能は追加せず、定数移設と shim 化による機能変更がないことを Outside-In の観測点とする。
- 接続テストと sqlite 操作の subtype 判定が従来どおりの結果を返すことを観測する。

### 統合テスト

- `src/background/handlers/dashboardSqliteProtocol.ts` を messaging 配下へ移した後も、dashboard → background の subtype 検証（`TOKEN_REQUIRED_SUBTYPES`）が同一の結果を返すことを一続きの経路として検証する。
- `src/background/messageTypes.ts` の re-export shim 経由の参照（`MessageRouter`・`aiTestProgressNotifier`・各 handler）が、移設後も同じ定数値を解決することを検証する。
- `CURRENT_PROTOCOL_VERSION` の参照が全て `src/messaging/protocol.ts` の直参照になり、値が SSOT と一致することを検証する。
- ESLint の `@typescript-eslint/no-restricted-imports` が `src/messaging/**/*.ts` に対して background への runtime import を拒否し、`import type` を許容することを検証する。
- `scripts/check-deprecated-aliases.mjs` は別名 alias 専用で `messageTypes.ts` を対象にしない（`npm run check-deprecated-aliases` で確認）。

### 単体テスト

- `src/messaging/validators.ts` の subtype 述語が移設後も同一の結果を返すことを pin する。
- `src/messaging/types.ts` の `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES` の値が不変であることを pin する。
- `AI_TEST_PROGRESS_MESSAGE_TYPE` と `CONTENT_SCRIPT_ALLOWED_TYPES` の参照側が移設後も同じ文字列を解決することを pin する。
- 既存の protocol-version 関連 pin テスト（2026-09-05-23 / 2026-08-23-08 の系譜）が import パスを mock していないかを確認し、必要なら更新する。

## 実装ガイド(低コストモデル向け)

### 0. 共通ルール(必読)

- ファイルは Read ツールの offset / limit で読む。`sed` / `awk` / `head` / `tail` / `cat` で読まない。検索は `grep -n` か `rg -n`。編集は Edit ツール。
- コードとコメントは英語。コメントは非自明な WHY のみ。production code に `any` / `unknown` を使わない。ESM import は必ず `.js` で終える。
- 固定時間 wait(`setTimeout` 待ち、`sleep`)や retry 回数の引き上げで test を通さない。待つなら Promise を await するか `testDir/waitPolicy.ts` の `waitForMock` を使う。`vi.useFakeTimers()` を既定オプションで呼ばない。
- 編集前に `file <path>` で改行コードを確認し、CRLF のファイルは CRLF を保つ(対象ファイルは現状すべて LF)。
- ツール呼び出しが権限で拒否されたら、回避せず作業を止めて報告する。
- 本 PBI は挙動を変えない refactor である。定数値・メッセージ契約・プロトコル版は 1 文字も変えない。

### 1. 前提と着手前チェック

行番号は目安(approx.)であり、識別子と引用で位置を特定する。zsh では `--include=*.ts` をクォートする。

```bash
cd /Users/yaar/Playground/obsidian-smart-history
git status --short                      # 想定: 空(他 PBI の作業が混ざっていない)
ls pbi/2026-09-28-10-refactor-layer0-limits-ssot.md dev-docs/archived/pbi/2026-09-28-10-refactor-layer0-limits-ssot.md 2>&1 | grep -v "No such"
# 想定: PBI 10 が dev-docs/archived/pbi/ 側に存在する(pbi/ 側に残っていたら 10 が未完了。着手せず報告)
```

現状の事実を次の 4 本の証明で確認する。どれかが想定と違えば実装を始めず、差分を報告する。

```bash
# (a) static な runtime 値 edge(想定: 2 ファイル = types.ts と messageTransport.ts の 2 行)
rg -Ul --glob '!**/__tests__/**' --glob '*.ts' "(?m)^(import|export)\s+(\{|\*)[^;]*?from\s+'\.\./background[^']*'" src/messaging
# 想定出力: src/messaging/messageTransport.ts / src/messaging/types.ts

# (b) type-only import(想定: pendingRecordGateway 1、types 1、messageTransport 1、validators 2、dashboardGateway 2 の計 7 文。全て `import type`)
grep -rn "background" src/messaging --include='*.ts' --exclude-dir=__tests__ | grep "from '\.\./background"

# (c) 動的 import(意図的な lazy edge。想定: 2 行 = auditLogGateway.ts の offscreenGateway、sqliteOperationSecurity.ts の confirmTokenManager)
grep -rn "import('\.\./background" src/messaging --include='*.ts' --exclude-dir=__tests__

# (d) CURRENT_PROTOCOL_VERSION の messageTypes 経由 import(型検査で網羅するため、この時点の件数は参考値)
grep -rln "messageTypes" src testDir --include='*.ts' | wc -l
```

補足(現状の事実):

- `src/messaging/dashboardGateway.ts` は `CURRENT_PROTOCOL_VERSION` を既に `./protocol.js` から直参照している。`src/messaging/validators.ts` の `isHttpScheme` は `../utils/archiveGuards.js` 由来で移設不要(値は `'http:' | 'https:'` のみ true)。
- `src/messaging/validators.ts` から `messageTypes` への import は type-only のみ。
- `src/background/handlers/dashboardSqliteProtocol.ts` の import は全て type-only で、`TOKEN_REQUIRED_SUBTYPES` は `src/messaging/sqliteOperationSecurity.ts` の re-export である。
- utils への runtime import は messaging に正当な形で多数ある(`errorMessage`、`backoffDelayMs`、`pickDefined`、`isHttpScheme` 等)。lint で禁止するのは background のみ。
- `scripts/check-deprecated-aliases.mjs` は `ProviderStrategy` 等の別名だけを検査し、`messageTypes.ts` は対象外。shim 化で誤検知は起きない。

### 2. 変更対象ファイル

作成:

- `src/messaging/messageTypeRegistry.ts`(runtime 定数 4 つの新しい置き場。import を一切持たない葉モジュール)
- `src/messaging/__tests__/messageTypeRegistry-parity.test.ts`(先行 parity テスト)
- `src/messaging/__tests__/layer-boundary.test.ts`(edge 0 件の機械検査)

移動(`git mv`): `src/background/handlers/dashboardSqliteProtocol.ts` -> `src/messaging/dashboardSqliteProtocol.ts`

編集:

- `src/background/messageTypes.ts`: 4 定数の実体を削除し `export { ... } from '../messaging/messageTypeRegistry.js'` に置換。最終 phase で `CURRENT_PROTOCOL_VERSION` / `PROTOCOL_VERSION_WINDOW_SIZE` の re-export を削除。`AiTestProgressMessage` interface と `ExtensionMessage` union と全 `export type` はここに残す。
- `src/messaging/types.ts`(`VALID_MESSAGE_TYPES` / `NO_PAYLOAD_TYPES` の import 元)、`src/messaging/messageTransport.ts`(`VALID_MESSAGE_TYPES`)。
- `dashboardSqliteProtocol` の importer 14 ファイル(手順 P2 で grep 列挙)。
- `eslint.config.js`(messaging 用ブロック追加)、`dev-docs/LAYERS.md`(messaging 境界の節を追記)、`dev-docs/ARCHITECTURE_MAP.md`(`src/messaging/messageTypeRegistry.ts` と `src/messaging/dashboardSqliteProtocol.ts` の行を追加)。

触らない:

- `manifest.json` / `wxt.config.ts` の `web_accessible_resources`(`src/utils` / `src/content` の分割ではなく、WAR は `content-extractor.js` と `icons/icon48.png` のみ)。
- `eslint/rules/utils-layer-boundary.mjs`、`scripts/lint-layers-docs.mjs`(utils の層表専用。messaging は登録しない)、`scripts/check-deprecated-aliases.mjs`。
- `src/messaging/` の動的 import 2 件、type-only import(`import type` のまま)、他の PBI ファイル。

### 3. 手順

各 phase は green(下記 6 の検証がすべて通る)で 1 コミットにする。

#### P0: parity テストを先に書く(4 節参照)

1. `messageTypeRegistry-parity.test.ts` を作る。この時点では import 元を `../../background/messageTypes.js` にして green を確認する。
2. `layer-boundary.test.ts` を作る(4 節)。この時点では 2 ファイルが違反するため red が正しい。コミットには含めず、P1 で green にしてから同じコミットに含める。
3. コミット: `test(messaging): メッセージ種別定数と validator の挙動を pin する`(parity テストのみ)。

#### P1: 定数 4 つを messaging へ移す

1. `src/messaging/messageTypeRegistry.ts` を作り、`src/background/messageTypes.ts` から次の 4 つを本体ごとコピーする(値・コメントも同一に保つ): `AI_TEST_PROGRESS_MESSAGE_TYPE`(`'AI_TEST_PROGRESS' as const`)、`VALID_MESSAGE_TYPES`、`CONTENT_SCRIPT_ALLOWED_TYPES`、`NO_PAYLOAD_TYPES`。すべて `export const`。ファイル先頭コメントは「wire 層が background に依存しないための葉モジュール。import を追加しない」旨だけを英語で書く。
2. `src/background/messageTypes.ts` の 4 定数の実体を消し、同じ位置に次を置く。`AiTestProgressMessage` の `typeof AI_TEST_PROGRESS_MESSAGE_TYPE` が解決するよう、`import` も併記する。

```ts
import { AI_TEST_PROGRESS_MESSAGE_TYPE } from '../messaging/messageTypeRegistry.js';
export {
    AI_TEST_PROGRESS_MESSAGE_TYPE,
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ALLOWED_TYPES,
    NO_PAYLOAD_TYPES,
} from '../messaging/messageTypeRegistry.js';
```

3. `src/messaging/types.ts`: `import { VALID_MESSAGE_TYPES, NO_PAYLOAD_TYPES } from '../background/messageTypes.js';` を `from './messageTypeRegistry.js'` に変える。次行の `import type { ExtensionMessage, TestObsidianResponse } from '../background/messageTypes.js';` はそのまま。
4. `src/messaging/messageTransport.ts`: `import { VALID_MESSAGE_TYPES } from '../background/messageTypes.js';` を `from './messageTypeRegistry.js'` に変える(直前の `import type { ExtensionMessage }` は残す)。
5. `layer-boundary.test.ts` が green になり、`(a)` の rg が空になることを確認する。`eslint.config.js` にブロックを追加する(下記)。
6. コミット: `refactor(messaging): メッセージ種別の runtime 定数を messaging 層へ移す`。

`eslint.config.js` の追加位置は `src/background/**/*.ts` ブロックの直後、`files: ['**/*.ts'], ignores: ['src/**/*.ts']` ブロックの直前。

```js
{
  files: ['src/messaging/**/*.ts'],
  ignores: ['src/**/__tests__/**'],
  languageOptions: { parser: tsParser },
  plugins: { '@typescript-eslint': tsPlugin },
  rules: {
    // Core rule cannot exempt `import type`; the TS variant can.
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/background/**'],
        allowTypeImports: true,
        message: 'messaging is the neutral wire layer: no runtime import from background (import type is allowed). See dev-docs/LAYERS.md.',
      }],
    }],
  },
},
```

lint の動作確認: `src/messaging/messageTransport.ts` の import 1 行を一時的に `'../background/messageTypes.js'` に戻し、`npx eslint src/messaging/messageTransport.ts` が error を出すことを確認してから元に戻す(コミットに含めない)。動的 `import('../background/...')` は本ルールの対象外で、2 件は意図的な lazy edge として残す。

#### P2: dashboardSqliteProtocol を messaging へ移す

1. importer を列挙する: `grep -rln "dashboardSqliteProtocol" src testDir --include='*.ts'`(想定 14 ファイル + 移動対象自身)。
2. `git mv src/background/handlers/dashboardSqliteProtocol.ts src/messaging/dashboardSqliteProtocol.ts`。
3. 移動したファイル内の相対 import を直す: `'../../utils/sqlite-types.js'` -> `'../utils/sqlite-types.js'`、`'../../messaging/sqliteMessages.js'` -> `'./sqliteMessages.js'`、`'../../messaging/sqliteOperationSecurity.js'` -> `'./sqliteOperationSecurity.js'`(`import type` と `export type` / `export { TOKEN_REQUIRED_SUBTYPES }` の 4 箇所)。
4. 各 importer の specifier を新パスへ更新する(例: `'../dashboardSqliteProtocol.js'` -> `'../../messaging/dashboardSqliteProtocol.js'`。messaging 内の 2 ファイルは `'./dashboardSqliteProtocol.js'`、`src/background/messageTypes.ts` は `'../messaging/dashboardSqliteProtocol.js'`)。すべて `import type` のまま維持し、shim は作らない(importer が全て type-only で、一度に更新できるため)。
5. `grep -rn "handlers/dashboardSqliteProtocol\|'\.\./dashboardSqliteProtocol\|'\.\./\.\./dashboardSqliteProtocol" src testDir --include='*.ts'` が空であること。
6. コミット: `refactor(messaging): dashboardSqliteProtocol を wire 契約として messaging 層へ移す`。

#### P3: CURRENT_PROTOCOL_VERSION の経路を 1 本にする

1. `src/background/messageTypes.ts` の `export { CURRENT_PROTOCOL_VERSION, PROTOCOL_VERSION_WINDOW_SIZE } from '../messaging/protocol.js';` とその直前の doc コメント(後方互換の説明)を削除する。
2. `npm run type-check` を実行する。`has no exported member 'CURRENT_PROTOCOL_VERSION'` / `'PROTOCOL_VERSION_WINDOW_SIZE'` と報告された全 import を `protocol.js` の直参照へ直す(`src/background/SessionAlarmService.ts`、`src/background/handlers/envelopePolicy.ts`、および複数行 import の一部)。type-check が拾わない test も含めるため、次の rg も併用する。

```bash
rg -n -U "\b(CURRENT_PROTOCOL_VERSION|PROTOCOL_VERSION_WINDOW_SIZE)\b[^;]*?from\s+'[^']*messageTypes\.js'" src testDir --glob '*.ts'
# 修正前は 13 ファイル(src 内 SessionAlarmService.ts / envelopePolicy.ts、残りは test)がヒットする。修正後の想定は空。ヒットした import は `from '<相対>/messaging/protocol.js'`(background 配下からは '../messaging/protocol.js' 等)へ直す
```

3. 複数の値を 1 つの import で読む箇所(例: `types.test.ts` は `CURRENT_PROTOCOL_VERSION, VALID_MESSAGE_TYPES, NO_PAYLOAD_TYPES`)は import 文を 2 本に分ける(protocol と registry)。
4. コミット: `refactor(messaging): CURRENT_PROTOCOL_VERSION の参照を protocol.ts 直参照に統一する`。

#### P4: 仕上げ

1. `dev-docs/LAYERS.md` に messaging 境界の節を 5 行程度で追記する(messaging から background への runtime import 禁止、`import type` と動的 import 2 件は例外、`eslint.config.js` のブロックと `layer-boundary.test.ts` が検査)。`dev-docs/ARCHITECTURE_MAP.md` の表に 2 行追加する(現状の仕様のみ、経緯は書かない)。
2. コミット: `docs(messaging): messaging 層の境界を LAYERS と ARCHITECTURE_MAP に記載する`。

### 4. テスト先行

`src/messaging/__tests__/messageTypeRegistry-parity.test.ts`(P0 で作成。値は現行コードからの写しで、変更禁止)。

- `VALID_MESSAGE_TYPES` が次と `toEqual`(順序込み)で一致する: `['VALID_VISIT','CHECK_DOMAIN','GET_CONTENT','FETCH_URL','MANUAL_RECORD','PREVIEW_RECORD','SAVE_RECORD','REGENERATE_SUMMARY','TEST_CONNECTIONS','TEST_OBSIDIAN','TEST_AI','GET_PRIVACY_CACHE','ACTIVITY_UPDATE','SESSION_LOCK_REQUEST','CONTENT_CLEANSING_EXECUTED','PING','REFRESH_LOCAL_MARKDOWN_SCHEDULER','CONSENT_STATE_CHANGED','DASHBOARD_SQLITE','GENERATE_REVIEW_SUMMARY','LOG_FORWARD']`(21 件)。
- `CONTENT_SCRIPT_ALLOWED_TYPES` は次と一致する: `['VALID_VISIT','CONTENT_CLEANSING_EXECUTED','CHECK_DOMAIN','PING']`。
- `NO_PAYLOAD_TYPES` は `['CHECK_DOMAIN','GET_CONTENT','GET_PRIVACY_CACHE','ACTIVITY_UPDATE','SESSION_LOCK_REQUEST','PING','REFRESH_LOCAL_MARKDOWN_SCHEDULER','CONSENT_STATE_CHANGED','TEST_CONNECTIONS','TEST_AI']`(10 件)。
- `AI_TEST_PROGRESS_MESSAGE_TYPE` は `'AI_TEST_PROGRESS'` で、`VALID_MESSAGE_TYPES` に含まれない。
- `CURRENT_PROTOCOL_VERSION` は `1`(`protocol.ts` の現行値。`toBe(1)`)。
- `isServiceWorkerRequest`(`../types.js`)の観測値: `{ type: 'PING' }` は true、`{ type: 'PING', payload: {} }` は false、`{ type: 'NOPE' }` は false、`{ type: 'VALID_VISIT' }`(payload なし)は false、`{ type: 'VALID_VISIT', payload: {} }` は true、`{ type: 'DASHBOARD_SQLITE' }` は true。
- `fetchUrlValidator.validate`(`../validators.js`): `{ type:'FETCH_URL', payload:{ url:'ftp://example.com' }, protocolVersion: 1 }` は `ValidationError` を投げる。`http://example.com` と `https://example.com` は成功する(`isHttpScheme` は utils 由来で移設しないが、validator の観測挙動として pin する)。
- `TOKEN_REQUIRED_SUBTYPES`(`../sqliteOperationSecurity.js`)は `Set` で、`size` と `[...set].sort()` を現行値のスナップショットとして期待値に書く(実装前に現行コードから値を取得して写す)。

import 元は P0 では `../../background/messageTypes.js`、P1 のコミットで `../messageTypeRegistry.js` に付け替える(付け替え前後で同じ assert が通ること自体が parity の証拠)。さらに P1 以降は、`messageTypes.js` の re-export が registry と同一参照(`toBe`)であることを 1 ケース加える。

`src/messaging/__tests__/layer-boundary.test.ts`: `node:fs` の `readdirSync`(recursive)で `src/messaging` 配下の `.ts`(`__tests__` 除外)を集め、各ファイルを次の正規表現で検査し、ヒットが 0 件であることを `expect(violations).toEqual([])` で確認する。

```ts
const STATIC_RUNTIME_EDGE = /^(?:import|export)\s+(?:\{|\*)[^;]*?from\s+'\.\.\/background[^']*'/m;
```

`import type { ... } from` は `import` の直後が `type` のため `\{` に一致せず許容される。テストの副次ケースとして、regex が `import { A } from '../background/x.js'` にヒットし `import type { A } from '../background/x.js'` にヒットしないことを文字列リテラルで検証する。

### 5. 既存テストへの影響

- `messageTypes` / `dashboardSqliteProtocol` / `messaging/types` / `messaging/validators` / `messaging/protocol` を `vi.mock` している test は現状ない(確認: `grep -rnE "vi\.(mock|doMock)\(.*(messageTypes|dashboardSqliteProtocol|messaging/(types|validators|protocol))" src testDir --include='*.ts'` が空)。新しい export を要する mock factory は発生しない。
- `messageTransport.js` を mock している popup 系 4 ファイル(`src/popup/recordCurrentPage/__tests__/previewFlow.test.ts`、`src/popup/__tests__/recordCurrentPage.test.ts`、`recordCurrentPage-extra.test.ts`、`main.test.ts`)は、`messageTransport.ts` の export を増減しないため変更不要。
- `src/background/__tests__/message-types-consistency.test.ts` は `messageTypes.ts` のソースを `readFileSync` して `ExtensionMessage` union を正規表現で読む。union の記述位置と書式を変えないこと。値 import は shim 経由で解決する。
- `src/__tests__/messaging-types-uniformity.test.ts` は `NO_PAYLOAD_TYPES` を shim 経由で読む。P1 後も green のはず。
- `auditLogGateway.test.ts` / `auditLogGateway.lazy.test.ts` は動的 import 先 `background/sqlite/offscreenGateway.js` を mock している。動的 edge は触らないため変更不要。

### 6. 検証コマンド(この順序)

```bash
npm run type-check
npm run lint                      # 0 errors
npm run lint:layers-docs
npx vitest run src/messaging src/background src/utils src/dashboard src/popup src/offscreen src/content
npx vitest run src/messaging/__tests__/messageTypeRegistry-parity.test.ts src/messaging/__tests__/layer-boundary.test.ts --repeats=20
rg -Ul --glob '!**/__tests__/**' --glob '*.ts' "(?m)^(import|export)\s+(\{|\*)[^;]*?from\s+'\.\./background[^']*'" src/messaging   # 期待出力: 空
grep -rn "import('\.\./background" src/messaging --include='*.ts' --exclude-dir=__tests__   # 期待: 動的 2 行のみ
npm run build
```

最終 phase では追加で `npm run validate` を通す。

### 7. 落とし穴

- 循環 import: `messageTypeRegistry.ts` に import を足さない。`messageTypes.ts` は registry を import するが、registry は `messageTypes.ts` を参照しない一方向を保つ。
- `AiTestProgressMessage` は `typeof AI_TEST_PROGRESS_MESSAGE_TYPE` を使うので、shim の `export { ... } from` だけでは型が解決しない。P1 手順 2 の `import` 併記を忘れない。
- messaging 配下では `import { A, type B }` のような混在 import を書かない。type-only は独立した `import type` 文にする(lint と layer-boundary の regex がその前提)。`src/background/handlers/envelopePolicy.ts` は混在 import(`type ExtensionMessage`)を持つが background 側なので P3 では `protocol.js` の import を分離するだけでよい。
- service worker / offscreen / content の bundle は `messageTypes.ts` を type-only で広く読む。registry は葉モジュールなので bundle 境界は増えない。content script の `loader.ts` は `CURRENT_PROTOCOL_VERSION` を static import せずビルド時注入(`__PROTOCOL_VERSION__`)で受けるため、この PBI で content bundle に新規依存は生えない。
- `wxt.config.ts` が `CURRENT_PROTOCOL_VERSION` を `src/messaging/protocol.ts` から読む契約(`protocol-ssot.test.ts` / `protocol-sync.test.ts`)を壊さない。`protocol.ts` は編集しない。
- `dashboardSqliteProtocol` の移動で相対パスの `../../` を 1 段減らし忘れると type-check が落ちる。移動後は `MODAL_REQUIRED_SUBTYPES`(唯一の runtime 値。値は変更しない)が同じ内容で残ることを diff で確認する。
- `src/background/messageTypes.ts` の値 re-export(4 定数)は shim として存置する。存置は本 PBI の決定であり、background 内の importer は更新しない。消すのは `CURRENT_PROTOCOL_VERSION` / `PROTOCOL_VERSION_WINDOW_SIZE` の re-export だけ。

### 8. コミットとアーカイブ手順

1. PBI の受け入れ基準と Definition of Done を `[x]` にする(`コードレビューが完了している` のみ `[ ]` のまま)。
2. 各 phase で変更ファイルを個別パスで add し、日本語 Conventional Commits(`refactor`、本文は WHY を書く)でコミットする。`git add -A` / `git add .` は使わない。zsh ではパスを配列に入れる。

```bash
files=(src/messaging/messageTypeRegistry.ts src/background/messageTypes.ts src/messaging/types.ts src/messaging/messageTransport.ts src/messaging/__tests__/messageTypeRegistry-parity.test.ts src/messaging/__tests__/layer-boundary.test.ts eslint.config.js)
git add "${files[@]}"
git commit -m "refactor(messaging): メッセージ種別の runtime 定数を messaging 層へ移す" -m "wire 層が background に static 依存していたため、定数の所在を messaging に一本化した。値は不変で parity テストで固定している。" -- "${files[@]}"
```

3. アーカイブ:

```bash
pbi=pbi/2026-09-28-14-refactor-messaging-background-edge-removal.md
git add "$pbi"
git mv "$pbi" dev-docs/archived/pbi/
arch=(dev-docs/archived/pbi/2026-09-28-14-refactor-messaging-background-edge-removal.md "$pbi")
git commit -m "docs(pbi): 09-28 PBI 14(messaging から background への edge 解消)をアーカイブする" -- "${arch[@]}"
```

### 9. 完了条件

- 6 節のコマンドがすべて成功し、edge 検査の rg 出力が空で、動的 import は 2 行のみである。
- `grep -rn "dashboardSqliteProtocol" src --include='*.ts'` の全ヒットが `messaging/dashboardSqliteProtocol.js` を指す(旧 `handlers/` パスが 0 件)。
- `CURRENT_PROTOCOL_VERSION` の import 元が `protocol.js` のみ(P3 の rg が空)。
- parity テストが移設前後で同一の期待値のまま `--repeats=20` を通っている。
- 受け入れ基準と DoD が `[x]`(`コードレビューが完了している` を除く)で、PBI がアーカイブ済みである。

## 見積もり

**2 SP**

定数 4 つの移設と re-export shim 化（1 SP）、`CURRENT_PROTOCOL_VERSION` 参照の 14 ファイル更新と lint 設定追加（0.5 SP）、`dashboardSqliteProtocol.ts`（177 行）の messaging 配下移設と既存 pin テストの import パス確認（0.5 SP）が内訳である。

## 技術的考慮事項

- `src/messaging/` から `src/background/` への static な runtime edge は 2 本である: `src/messaging/types.ts`（`VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES`）と `src/messaging/messageTransport.ts`（`VALID_MESSAGE_TYPES`）。`dashboardGateway.ts` は既に `./protocol.js` を直参照しており、`validators.ts` の `isHttpScheme` は `utils/archiveGuards.ts` 由来で background 経由ではない。
- type-only import は 7 文（`pendingRecordGateway.ts` 1、`types.ts` 1、`messageTransport.ts` 1、`validators.ts` 2、`dashboardGateway.ts` 2）であり、移設不要である。動的 `import('../background/...')` が 2 件（`auditLogGateway.ts` の `offscreenGateway`、`sqliteOperationSecurity.ts` の `confirmTokenManager`）あり、意図的な lazy edge として残す。
- 閉路は `src/messaging/validators.ts` → `src/background/handlers/dashboardSqliteProtocol.ts` → `src/messaging/sqliteMessages` の順である。type-only であるため runtime 閉路にはならないが、設計上の逆転になっている。
- `src/background/handlers/dashboardSqliteProtocol.ts` は 177 行で、runtime 値は `MODAL_REQUIRED_SUBTYPES` と、`sqliteOperationSecurity.ts` からの `TOKEN_REQUIRED_SUBTYPES` re-export である。importer は 14 ファイルで全て type-only。
- `CURRENT_PROTOCOL_VERSION` の SSOT は `src/messaging/protocol.ts` である。`src/background/messageTypes.ts` の re-export 経由の import は `SessionAlarmService.ts`、`envelopePolicy.ts` と test 11 ファイルである（`popup` / `dashboard` の本体コードは経由していない）。
- 移設対象は `src/background/messageTypes.ts`（321 行）の runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）である。`ExtensionMessage` union は `import type` のため移設不要である。
- 依存先として 2026-09-28-10（Layer 0 caps SSOT）がある。`src/messaging/validators.ts` と limits 領域が重なるため、10 の後に実装する。
- lint は `eslint/rules/utils-layer-boundary.mjs` ではなく `@typescript-eslint/no-restricted-imports` 1 本とする。`files: ['src/messaging/**/*.ts']` ブロックで「background への runtime import 禁止（`import type` は許可）」を宣言する。
- `src/messaging/validators.ts:22,31` の utils import（`archiveGuards` / `cleansesModeLadder`）は方向として許容される（utils は基盤）。完了条件には「messaging から background への runtime edge 0 件」のみを入れる。
- 観測される挙動は不変とする。定数値、メッセージ契約、プロトコルバージョンの値は変更しない。

## 決定事項

1. `src/messaging/` を中立 wire 層として成立させる理由は、runtime 定数が background に置かれたことで wire 層が background に依存する構造になったためである。
2. type-only import 7 文を移設対象から除外する理由は、type-only は実行時の依存を作らず、`ExtensionMessage` union も移設不要であるためである。
3. `src/background/handlers/dashboardSqliteProtocol.ts` を messaging 配下へ移す理由は、runtime 値が `TOKEN_REQUIRED_SUBTYPES` のみであり wire 契約として messaging 配置が自然で、自身が `:14-15` で `src/messaging/sqliteMessages.ts` と `src/messaging/sqliteOperationSecurity.ts` を import しているからである。
4. `CURRENT_PROTOCOL_VERSION` の SSOT は `src/messaging/protocol.ts` とし、参照を直参照 1 経路に収束させる。`src/background/messageTypes.ts` は re-export shim に降格する。
5. 移設対象は `src/background/messageTypes.ts`（321 行）の runtime 定数 4 つに限定する。`ExtensionMessage` union は移設しない。
6. lint は `eslint/rules/utils-layer-boundary.mjs` ではなく `@typescript-eslint/no-restricted-imports` 1 本とし、`files: ['src/messaging/**/*.ts']` ブロックで background への runtime import を拒否する（`import type` は許可。utils は基盤層のため対象外）。
7. `src/messaging/validators.ts:22,31` の utils import（`archiveGuards` / `cleansesModeLadder`）は方向として許容されるため、完了条件には「messaging から background への runtime edge 0 件」のみを入れる。
8. import 更新は shim を介した段階移行とし、実装冒頭で `rg` による網羅リストを作成する。shim の存置期間を明示してから存置可否を再検討する。
9. 定数値、メッセージ契約、プロトコルバージョンの値は変更せず、観測される挙動を不変とする。依存先 2026-09-28-10（Layer 0 caps SSOT）の後に実装する。

## Definition of Done

- [x] runtime 定数 4 つ（`AI_TEST_PROGRESS_MESSAGE_TYPE` / `VALID_MESSAGE_TYPES` / `CONTENT_SCRIPT_ALLOWED_TYPES` / `NO_PAYLOAD_TYPES`）が `src/messaging/` へ移されている。
- [x] `src/background/messageTypes.ts` が re-export shim に降格し、`ExtensionMessage` union が `import type` のまま残されている。
- [x] `src/messaging/` から `src/background/` への runtime import が 0 件になっている。
- [x] type-only import 7 文が `import type` のまま維持されている。
- [x] `src/background/handlers/dashboardSqliteProtocol.ts` が messaging 配下へ移され、wire 契約として配置されている。
- [x] `CURRENT_PROTOCOL_VERSION` の参照が `src/messaging/protocol.ts` の直参照 1 経路に収束している。
- [x] `@typescript-eslint/no-restricted-imports` の `files: ['src/messaging/**/*.ts']` ブロックが background への runtime import を拒否し、`import type` を許容する。
- [x] `messageTypes` 経由の `CURRENT_PROTOCOL_VERSION` import が 0 件で、実装ガイド P3 の `rg` が空である。
- [x] `npm run check-deprecated-aliases` が shim 化後も成功している。
- [x] 既存の protocol-version 関連 pin テストが import パスを mock していた場合の更新が完了している。
- [x] 定数値、メッセージ契約、プロトコルバージョンの値が変更されていない。
- [x] `npm run validate` が成功し、既存テストとビルドに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
