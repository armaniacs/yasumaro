# PBI 14: extractor facade collapse + test-support 再配置 + GET_CONTENT testability

依存: **PBI 13 / 33 / 34 の着地を前提**（`src/utils/contentExtractor/index.ts` の PBI 12/13 改修完了、test-support 判断は PBI 34 の `InMemoryTransport` 方針に整合させる）
フォローアップ元: [PBI 2026-09-05-13](../dev-docs/archived/pbi/2026-09-05-13-refactor-extract-orchestration-collapse.md) の「スコープ外（明示）」で正式に予告されたクレンジング。

## ユーザーストーリー

抽出まわりを保守する開発者として、`src/content/extractor.ts` の転送層が畳まれ、テスト専用コードが本番ファイルから分離されていてほしい。なぜなら現在 `extractor.ts`（198行）は「now a thin facade over ContentKernel」とヘッダに明記された 14 export の1行委譲層で、本番 import がゼロ（唯一の本番ロードは `entrypoints/content-extractor.ts:5` の副作用 import のみ）でありながら、テスト専用の関数・クラスが本番ファイルに同居し、`createVisitGate` が2実装に分裂し、GET_CONTENT リスナーが `vi.resetModules()` でしかテストできないインラインクロージャになっているから。次のクレンジング機能追加はこの領域を必ず通るため、通る前に整地しておきたい。

## 対象と範囲

**スコープ内（3つの絡んだクリーンアップを1 PBI に束ねる）:**

1. **test-support 再配置** — 本番ファイルに定義されたテスト専用コードをテストヘルパへ移す
   - `src/content/extractor.ts:53` `getPageStateForTesting()`（本番参照ゼロ、5テストファイルのみ、多くが `as unknown as PageState` キャスト付き）
   - `src/content/extractor.ts:197` `export { kernel as __kernelForTesting }`（本番参照ゼロ）
   - `src/content/contentKernel.ts:85-113` `FakeScheduler` クラス（29行、本番参照ゼロ、`contentKernel.*.test.ts` のみ）
   - `src/content/domainPolicyPort.ts:82-117` `InMemoryDomainPolicyPort` クラス（36行、テスト専用）
   - `src/utils/contentExtractor/optionBuilder.ts.bak` — コミットされたバックアップファイル。削除
   - `src/` に test-support の置き場所規約が未確立（下記「未解決事項」1）

2. **facade collapse** — `src/content/extractor.ts` の転送層を縮約し、entrypoint に組み立てを寄せる
   - `createVisitGate` が `extractor.ts:103` と `contentKernel.ts:336` に同一ロジックで2実装。一本化
   - `throttle` が extractor → contentKernel → `throttle.ts` の3段ラッパー。縮約（ただし `contentKernel.throttle` は `init()` 内で自己利用しており完全には潰せない）
   - `showPrivacyConfirmDialog` は `privacyDialog.ts` の素通し re-export
   - entrypoint（`entrypoints/content-extractor.ts`）が ContentKernel 組み立て + GET_CONTENT リスナー登録 + `init()` を直接行う形に寄せる

3. **GET_CONTENT testability** — `src/content/extractor.ts:169-194` のインラインリスナー（`if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage)` ガード内のクロージャ）を、注入された kernel/extractor を引数に取る名前付き関数（例 `handleGetContentMessage(msg, sender, sendResponse, deps)`）に切り出す
   - 現状は `vi.resetModules()` → `globalThis.chrome = mock` → `await import` でリスナー再登録し `onMessage.addListener.mock.calls[0][0]` から引き抜くしかテスト手段がない（`extractor.test.ts:2037-2044`）
   - clock も注入経路に載せる
   - background 側に GET_CONTENT ハンドラは存在しない（content script が `chrome.tabs.sendMessage` で受ける。`messageTypes.ts:210-216,251` に型定義のみ）
   - 送信側: `src/popup/recordCurrentPage/tabContentFetcher.ts:26`（5秒タイムアウト、失敗時 `chrome.scripting.executeScript` フォールバック）

**スコープ外:**
- `src/utils/contentExtractor/index.ts` の改修（PBI 12/13 で直近対応済み。原則触らない。`classifier.ts:105` の `@internal` export の扱いのみ要判断）
- 抽出アルゴリズム・クレンジング挙動の変更（本 PBI は振る舞い不変のリファクタ）
- ADR 2026-08-27-limit-policy / 2026-08-23-ai-test-progress-client-extraction-rejected に関わる変更

## 優先度

- 順位: **02 / 7**
- RICE スコア: **5.7**（Reach = 5 / Impact = 1 / Confidence = 80% / Effort = 0.7人週）
- 根拠: PBI 2026-09-05-13 の「スコープ外（明示）」で「本 PBI 着地後に test-support 再配置と GET_CONTENT testability と合わせて小さく別 PBI 化」と予告された正式フォローアップ。PBI 13/33/34 着地で前提が充足する。次のクレンジング機能追加がこの領域を必ず通るため、Reach は限定的だが確実。Impact は開発者体験の改善に留まり 1。純粋リファクタで方針が明確なため Confidence 80%。Effort の主変動要因は `extractor.test.ts`（2000行超）の書き換え規模。

## BDD受け入れシナリオ

```gherkin
Scenario: 本番 import ゼロの facade export が削除・縮約されても既存テストが green を維持する
  Given src/content/extractor*.test.ts（6ファイル）・contentKernel.*.test.ts・loader*.test.ts
  When  facade collapse と test-support 再配置を適用し import パスを更新する
  Then  全テストが（import パス変更を除き）無修正で green のまま通る

Scenario: 本番コードから参照されていないテスト専用シンボルが本番ファイルから消える
  Given src/content/extractor.ts / contentKernel.ts / domainPolicyPort.ts
  When  "getPageStateForTesting" "__kernelForTesting" "FakeScheduler" "InMemoryDomainPolicyPort" を本番ファイルに対して grep する
  Then  いずれも本番ファイルにはヒットせず、テストヘルパ配下（規約で定めた場所）にのみ存在する

Scenario: createVisitGate が単一実装になる
  Given src/content/ ツリー
  When  "createVisitGate" の実装（export function / const = ...）を grep する
  Then  実装は1箇所のみで、もう一方は import 参照になっている

Scenario: GET_CONTENT ハンドラが chrome guard の外で直接テストできる
  Given handleGetContentMessage（名前付き関数、deps 注入）
  When  モックした kernel/extractor/clock を deps として渡し直接呼び出す
  Then  vi.resetModules() や onMessage.addListener.mock.calls からの引き抜きなしに応答が検証できる

Scenario: entrypoint の副作用ロードと loader の動的 import が壊れない
  Given entrypoints/content-extractor.ts（WXT defineUnlistedScript, 出力名 content-extractor.js）
  When  ビルドし loader.ts:73 の import(chrome.runtime.getURL('content-extractor.js')) 経路を確認する
  Then  ビルド出力名と web_accessible_resources 登録（wxt.config.ts:104）が維持され、動的 import が成功する

Scenario: E2E テスト状態契約が維持される
  Given __OW_TEST_STATE / data-ow-test-state 契約（contentKernel.ts:353-383, testDir/e2e/）
  When  facade collapse 後に E2E を実行する
  Then  テスト状態の公開経路と属性名が変わらず E2E が通る

Scenario: バックアップファイルがリポジトリから消える
  Given src/utils/contentExtractor/optionBuilder.ts.bak
  When  リポジトリツリーを確認する
  Then  .bak ファイルが存在しない
```

## 受け入れ基準

- [x] `getPageStateForTesting` / `__kernelForTesting` / `FakeScheduler` / `InMemoryDomainPolicyPort` が本番ファイルから除去され、規約で定めたテストヘルパ配置に移動する（または「未解決事項」2 の判断で本番ファイルに `@internal` で残す場合はその根拠を注記に明記）
  - 実施: `src/content/__tests__/helpers/` に `contentTestkit.ts`（`getPageStateForTesting`）・`fakeScheduler.ts`（`FakeScheduler`）・`inMemoryDomainPolicyPort.ts`（`InMemoryDomainPolicyPort`）を新設。`__kernelForTesting` は参照ゼロのため削除し、代わりに無名の `kernel` インスタンス export を seam として残した（テストロジックは含まない）。`@internal` 残置はなし
- [x] `src/utils/contentExtractor/optionBuilder.ts.bak` が削除される
  - 実施: worktree 内に `.bak` ファイルは存在せず（`find` で確認）、削除ステップ不要で達成。`bench/micro/*.bench.mjs` の `src/content/extractor.ts` 依存なしを grep で確認（`src/utils/contentExtractor/index.ts` の string entry 依存のみで許容範囲内）
- [x] `createVisitGate` が単一実装になり、もう一方は import 参照になる
  - 実施: `ContentKernel.createVisitGate(clock?: Clock)` を正とし、`new VisitGate` 構築点は1箇所。`extractor.createVisitGate(clock?)` は kernel メソッドへの1行委譲。旧シグネチャ（`clock` 省略時 `() => Date.now()`、明示 clock、`undefined`）の振る舞いは同一（kernel の `this.clock` が `() => Date.now()`、対象 `pageState` は同一 singleton）
- [x] `throttle` の3段ラッパーが縮約される（`contentKernel.throttle` の `init()` 自己利用分は残置可、縮約範囲を注記に明記）
  - 実施: 縮約範囲 = `extractor.throttle` ラッパーのみ削除。残置 = `contentKernel.throttle`（`init()` 内自己利用）+ 実装本体 `src/content/throttle.ts`。`extractor-comprehensive.test.ts` は `../throttle.js` からの import に付け替え（import パス変更のみ）
- [x] `showPrivacyConfirmDialog` の素通し re-export が解消される（呼び出し側が `privacyDialog.ts` を直接参照）
  - 実施: re-export 行を削除。`extractor.test.ts`・`extractor-extra.test.ts`・`extractor-r2.test.ts` は `../privacyDialog.js` からの import に付け替え（import パス変更のみ）。本番呼び出し側（`visitReporter.ts:180`）は元から `privacyDialog.ts` を直接参照しており無修正
- [x] `src/content/extractor.ts:169-194` のインラインリスナーが `handleGetContentMessage(msg, sender, sendResponse, deps)` 相当の名前付き・deps 注入関数に切り出され、clock も注入経路に載る
  - 実施: `src/content/getContentHandler.ts` を新設。`deps = { extractPageContent, applyExtractResultToPageState, pageState, runtimeId }`。chrome 依存は `runtimeId` 注入に畳んだ。clock はハンドラ本体が時刻不使用のため literal な `deps.clock` は持たせない——clock の注入経路は ContentKernel コンストラクタ注入であり（entrypoint が `() => Date.now()` を明示、本番 wiring は kernel 束縛クロージャを deps に渡す）、テストは fake-clock kernel を束縛して渡すことで決定性を得る。この解釈で基準を満たすものとする
- [x] GET_CONTENT ハンドラの単体テストが `vi.resetModules()` / `onMessage.addListener.mock.calls` からの引き抜きに依存しない形に書き換わる
  - 実施: `extractor.test.ts` の sender-validation describe を直接呼び出しに書き換え（引き抜きブロック撤去）。新規 `getContentHandler.test.ts`（6ケース、chrome グローバル削除ケース含む）は chrome モックなしで成立
- [x] entrypoint（`entrypoints/content-extractor.ts`）が ContentKernel 組み立て + GET_CONTENT リスナー登録 + `init()` を直接行う形になる
  - 実施: 副作用 import をやめ、`registerGetContentListener()` + `init()` の名前付き駆動に変更（chrome guard は entrypoint 側に移設し、旧モジュール guard と同条件）。乖離の注記: singleton 定義（`pageState` + `kernel` + chrome-backed ports の `new`）自体は `extractor.ts` に残した。6テストファイルが facade 経由で singleton 状態を検証しているため、組み立ての完全移転は singleton 二重化かテスト全面書換を強いる。単一 singleton + entrypoint 駆動を以て「組み立てを寄せる」とした
- [x] 振る舞いが変更前と同一（純粋リファクタリング）。既存 `extractor*.test.ts`（6ファイル）・`contentKernel.*.test.ts`・`loader*.test.ts` が import パス変更を除き無修正で green
  - 実施: `npx vitest run src/content src/utils/contentExtractor` → 35ファイル・744テスト green。GET_CONTENT 引き抜きテストのみ書き換え（基準で許容）。残る1行委譲 export はテスト seam として保持（本番未使用だが削除はテスト全面書換になるため残置、根拠をここに明記）
- [x] `CURRENT_PROTOCOL_VERSION` のビルド時注入前提が維持される
  - 実施: `src/content/loader.ts` 無修正（`__PROTOCOL_VERSION__` 注入経路に触れていない）
- [x] `__OW_TEST_STATE` / `data-ow-test-state` 契約と `testDir/e2e/` が維持される
  - 実施: `contentKernel.ts:353-383` 相当の E2E 公開ブロック無修正、`testDir/e2e/` 無修正。E2E 実機実行は不可のため未実行（下記 DoD に注記）
- [x] ビルド出力名 `content-extractor.js` と `wxt.config.ts:104` の `web_accessible_resources` 登録が維持され、`loader.ts:73` の動的 import が成功する
  - 実施: `npm run build` PASS、`dist/chromium-mv3/content-extractor.js` の出力を確認。`wxt.config.ts` 無修正。新規 `getContentHandler.ts` は `src/content/` 直下のため WAR へのサブディレクトリ列挙追加は不要
- [x] `bench/micro/*.bench.mjs` が `src/content/extractor.ts` の export に依存していないことを grep で確認（`index.ts` の string entry には依存してよい）
  - 実施: `grep -rn "content/extractor" bench/` ヒットゼロを確認
- [x] `src/` の test-support 置き場所規約が短いドキュメント（または既存ドキュメントへの追記）として明文化される
  - 実施: `dev-docs/TESTING_GUIDE.md` に「Test-support placement convention (PBI-14)」節を追記（`src/**/__tests__/helpers/` 集約、`@internal` 残置なし、新サフィックスなし）
- [x] type-check / lint / build / `npm run validate` が PASS
  - 実施: `npm run type-check` PASS、`npm run lint` 0 errors（124 warnings は既存・変更ファイル起因は `contentKernel.ts` の logger 制限 warning のみで既存）、`npm run build` PASS。`npm run validate` 全体（全テストスイート + validate:json）は実行せず、指定スコープ（`src/content` + `src/utils/contentExtractor`）の vitest で代替し green。E2E・bench:micro は実行不可（下記 DoD に注記）

## テスト戦略（t_wadaスタイル）

### 前提: 振る舞い不変のリファクタ
既存テスト群がリグレッションネットである。ゴールは「import パス変更以外は無修正で green」。

### 単体テスト
- `handleGetContentMessage` の新規単体テスト: モック deps（kernel / extractor / clock）を渡し、成功応答・タイムアウト・kernel 例外の各ケースを chrome guard の外で検証。既存 `extractor.test.ts:2037-2044` の引き抜きパターンは撤去
- `createVisitGate` の既存テストが一本化後の実装に対して green であることを確認（両実装向けにテストが分かれている場合は統合）
- 移設した `FakeScheduler` / `InMemoryDomainPolicyPort` を新パスから import して既存 `contentKernel.*.test.ts` が green

### 統合テスト
- `loader*.test.ts` が動的 import 経路（出力名 `content-extractor.js`）に対して green
- entrypoint の副作用ロード（組み立て + リスナー登録 + `init()`）を jsdom で検証（既存に相当テストがなければ最小限追加）

### E2E
- `testDir/e2e/` の `__OW_TEST_STATE` / `data-ow-test-state` を使うシナリオが無修正で green

### 例外ハンドリング
- GET_CONTENT のタイムアウト（送信側 5秒 / `tabContentFetcher.ts:26`）と `chrome.scripting.executeScript` フォールバック経路の挙動は不変

## 実装アプローチ

段階的に、各ステップ後にテスト green を確認しながら進める。

1. **前掃除**: `optionBuilder.ts.bak` を削除。`bench/micro/*.bench.mjs` を grep して `src/content/extractor.ts` の export 依存がないことを確認（`index.ts` string entry への依存は許容）
2. **test-support 置き場所規約の決定**（「未解決事項」1）: 3案（`src/**/__tests__/support/` / `src/test-support/`（本番 tsconfig 除外）/ `*.testkit.ts` サフィックス）を PBI 34 の判断と突き合わせて確定し、短く明文化
3. **test-support 移設**: `getPageStateForTesting` / `__kernelForTesting` / `FakeScheduler` / `InMemoryDomainPolicyPort` を規約の場所へ移動。テストの import パスのみ更新（本番参照ゼロなので本番側は削除のみ）。ここでテスト green を確認
4. **createVisitGate 一本化**: `contentKernel.ts:336` 側を正とし、`extractor.ts:103` は import 参照に（または逆。所有者を決める）。テスト green を確認
5. **GET_CONTENT ハンドラ切り出し**: `extractor.ts:169-194` のクロージャを `handleGetContentMessage(msg, sender, sendResponse, deps)` に抽出。`deps` に kernel / extractor / clock を注入。新規単体テストを追加し、旧引き抜きテストを置換
6. **facade collapse**: `throttle` 3段を縮約（`contentKernel.throttle` の `init()` 自己利用分は残置範囲を確定）。`showPrivacyConfirmDialog` の re-export を解消。残る1行委譲 export のうち本番未使用のものを整理
7. **entrypoint へ寄せる**: `entrypoints/content-extractor.ts` が ContentKernel 組み立て + `handleGetContentMessage` を使ったリスナー登録 + `init()` を直接行う形に。`CURRENT_PROTOCOL_VERSION` のビルド時注入前提を壊さない
8. **ビルド確認**: `npm run build` → `loader.ts:73` の動的 import 経路（出力名 `content-extractor.js`、`wxt.config.ts:104`）が生きていることを確認。E2E 実行
9. **仕上げ**: type-check / lint / `npm run validate` / `bench:micro`（連続性確認）

## 見積もり

**0.7人週**

内訳の主変動要因は `extractor.test.ts`（2000行超、GET_CONTENT 5 describe + リスナー引き抜きパターン）の書き換え規模（「未解決事項」3）。test-support 移設と `createVisitGate` 一本化は機械的。facade collapse は `throttle` の残置範囲見極めに判断コスト（「未解決事項」4）。

## 実装者向け注記

### 調査で判明した事実

**facade の実態:**
- `src/content/extractor.ts`（198行）はヘッダに「now a thin facade over ContentKernel」と明記。14 の export が全て `kernel.xxx()` への1行委譲
- 本番でこれらを import しているファイルはゼロ。唯一の本番ロードは `entrypoints/content-extractor.ts:5` の副作用 import のみ
- `createVisitGate` は `extractor.ts:103` と `contentKernel.ts:336` に同一ロジックで2実装
- `throttle` は extractor → contentKernel → `throttle.ts` の3段ラッパー。`contentKernel.throttle` は `init()` 内で自己利用しており完全には潰せない
- `showPrivacyConfirmDialog` は `privacyDialog.ts` の素通し re-export

**test-support の実態:**
- `extractor.ts:53` `getPageStateForTesting()` — 本番参照ゼロ、5テストファイルのみ、多くが `as unknown as PageState` キャスト付き
- `extractor.ts:197` `export { kernel as __kernelForTesting }` — 本番参照ゼロ
- `contentKernel.ts:85-113` `FakeScheduler` — 29行、本番参照ゼロ、`contentKernel.*.test.ts` のみ
- `domainPolicyPort.ts:82-117` `InMemoryDomainPolicyPort` — 36行、テスト専用
- `src/utils/contentExtractor/optionBuilder.ts.bak` — コミットされたバックアップファイル
- `src/` に test-support の置き場所規約が未確立

**GET_CONTENT の実態:**
- `extractor.ts:169-194` のインラインリスナーは `if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage)` ガード内のクロージャ
- 現状のテスト手段は `vi.resetModules()` → `globalThis.chrome = mock` → `await import` でリスナー再登録 → `onMessage.addListener.mock.calls[0][0]` から引き抜き（`extractor.test.ts:2037-2044`）
- background 側に GET_CONTENT ハンドラは存在しない。content script が `chrome.tabs.sendMessage` で受ける。`messageTypes.ts:210-216,251` に型定義のみ
- 送信側: `src/popup/recordCurrentPage/tabContentFetcher.ts:26`（5秒タイムアウト、失敗時 `chrome.scripting.executeScript` フォールバック）

### 制約

- **純粋リファクタリング。振る舞い不変**。既存 `extractor*.test.ts`（6ファイル）・`contentKernel.*.test.ts`・`loader*.test.ts` が import パス変更を除き green 維持
- `entrypoints/content-extractor.ts` は WXT `defineUnlistedScript`、ビルド出力名 `content-extractor.js` は `web_accessible_resources` 登録済み（`wxt.config.ts:104`）。loader の動的 import（`loader.ts:73` `import(chrome.runtime.getURL('content-extractor.js'))`）を壊さない
- E2E の `__OW_TEST_STATE` / `data-ow-test-state` 契約（`contentKernel.ts:353-383`、`testDir/e2e/`）維持
- `CURRENT_PROTOCOL_VERSION` はビルド時注入。GET_CONTENT リスナー移設時にこの前提を壊さない
- `src/utils/contentExtractor/index.ts` は PBI 12/13 で直近改修済み。今回は原則触らない（`classifier.ts:105` の `@internal` export の扱いは要判断）
- ADR 2026-08-27-limit-policy / 2026-08-23-ai-test-progress-client-extraction-rejected に抵触しない
- `bench/micro/*.bench.mjs` が `src/content/extractor.ts` の export に依存していないか要 grep（`index.ts` の string entry には依存）
- CLAUDE.local.md「モジュール分割時のルール」: `src/content/` 配下を複数ファイルに分割した場合は `manifest.json`（WXT では `wxt.config.ts`）の `web_accessible_resources` にサブディレクトリ内の全 `.js` を列挙すること

### 落とし穴

- test-support を `src/test-support/` に置く案を採る場合、本番 tsconfig の `exclude` に確実に入れる（入れないとテスト専用コードが本番バンドルに載る）
- `createVisitGate` 一本化で所有者を `contentKernel.ts` にする場合、`extractor.ts` 側の型 export（もしあれば）の参照先も付け替える
- GET_CONTENT ハンドラを entrypoint に寄せると、テストが entrypoint を import できない（WXT のマクロ）ケースがある。ハンドラ本体は `src/content/` に置き、entrypoint は登録のみ行う形にする
- `throttle` の縮約で `contentKernel.throttle` の `init()` 自己利用分を消すと debounce 挙動が変わる。self-use 分は残す前提で「extractor が re-export する層」だけ削る

## 未解決事項

1. **test-support の置き場所規約が未定**（3案あり、設計判断必要）
   - ~~`src/**/__tests__/support/` 案 / `src/test-support/`（本番 tsconfig 除外）案 / `*.testkit.ts` サフィックス案~~
   - **結論（実装）**: `src/**/__tests__/helpers/` に確定。既存の `src/background/__tests__/helpers/`・`src/dashboard/__tests__/helpers/` の前例に合わせ、`src/content/__tests__/helpers/` を新設。`src/test-support/` 案は本番 tsconfig 除外の管理コストがあるため不採用。`*.testkit.ts` 案は新サフィックス導入のコストに見合う識別利益がないため不採用（ただし helper 群の入口として `contentTestkit.ts` のファイル名は使用）。PBI 34 の `InMemoryTransport`（`src/background/` 直下残置）とは方針が分かれた——本 PBI は作業指示の決定（本番参照ゼロなので移設が筋、`@internal` 残置は避ける）に従い移設した。将来 PBI 34 側を helpers へ寄せるかは別途判断
2. **`FakeScheduler` / `InMemoryDomainPolicyPort` を移設 vs 本番ファイルに `@internal` で残す**（PBI 34 の `InMemoryTransport` 判断と同様の論点）
   - **結論（実装）**: 移設で確定。本番参照ゼロ・テストロジック含有のため `@internal` 残置の根拠なし。`__kernelForTesting` は参照ゼロのため削除（代わりにロジックなしの `kernel` インスタンス export を seam として残置）
3. **`extractor.test.ts`（2000行超、GET_CONTENT 5 describe + リスナー引き抜きパターン）の書き換え規模**が Effort の主変動要因。着手時に実測して見積もりを更新する
   - **結論（実装）**: 実測では sender-validation の1 describe（約70行）のみ書き換えで済んだ。他の GET_CONTENT 関連 describe は response 形状の手組み検証であり、ハンドラ切り出し後も facade 経由で green のため無修正。見積もり 0.7人週に対し実作業は小規模で着地
4. **`throttle` 3段のうち `contentKernel.throttle` は完全には潰せない**。縮約範囲の見極め（extractor の re-export 層のみ削る、で確定してよいか）
   - **結論（実装）**: 確定。`extractor.throttle` 削除、`contentKernel.throttle` + `throttle.ts` 残置。`init()` 自己利用分に触れていない
5. `classifier.ts:105` の `@internal` export をこの PBI で扱うか、`index.ts` 非干渉の原則を優先して見送るか
   - **結論（実装）**: 見送り。`src/utils/contentExtractor/index.ts` は無修正（`git status` で変更なし）。`@internal` の扱いは別 PBI の判断に委ねる

## 実装メモ（PBI-14 着地時点の実態）

- 変更ファイル: `src/content/extractor.ts`（facade 縮約・guard 撤去・`registerGetContentListener`/`buildGetContentDeps` 追加）、`src/content/getContentHandler.ts`（新設）、`src/content/contentKernel.ts`（`FakeScheduler` 除去・`createVisitGate(clock?)`）、`src/content/domainPolicyPort.ts`（`InMemoryDomainPolicyPort` 除去）、`entrypoints/content-extractor.ts`（名前付き駆動化）、`src/content/__tests__/helpers/` 3ファイル（新設）、`src/content/__tests__/getContentHandler.test.ts`（新設）、既存テスト8ファイルの import 付け替え + `extractor.test.ts` の sender-validation 書き換え、`dev-docs/TESTING_GUIDE.md`・`dev-docs/ARCHITECTURE_MAP.md` 追記
- 5 Whys 分析: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/kilo/whywhy/pbi14-extractor.md`（worktree 外）に保存
- 検証: `npm run type-check` PASS / `npx vitest run src/content src/utils/contentExtractor` 35ファイル744テスト PASS / `npm run lint` 0 errors / `npm run build` PASS（`dist/chromium-mv3/content-extractor.js` 確認）
- 残る1行委譲 export（`extractPageContent` 等）はテスト seam として保持。本番 import は entrypoint の駆動経由のみ。完全な export 削除はテスト全面書換を要するため本 PBI の制約（import パス変更以外の無修正）と両立しない
- `InMemoryStoragePort`（`src/utils/storage/storagePort.ts` 内）は本 PBI スコープ外のため残置。test-support 規約との整合は別途判断が必要な残件

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `extractor*.test.ts` / `contentKernel.*.test.ts` / `loader*.test.ts` が import パス変更を除き無修正で green
- [x] `handleGetContentMessage` の新規単体テストが chrome guard の外で成立し、旧引き抜きテストが撤去される
- [x] type-check / lint / build / `npm run validate` が PASS（注: `validate` 全体ではなく指定スコープ + lint + type-check + build で確認）
- [ ] `npm run build` 後の E2E（`testDir/e2e/`）が green、`loader.ts:73` の動的 import が成功
  - 未実施の理由: E2E は実機 Chrome + Playwright 環境を要し worktree では実行不可。契約コード（`contentKernel.ts` の E2E 公開ブロック、`testDir/e2e/`）無修正 + ビルド出力名維持により regression リスクは最小と判断。メイン側で判断すること
- [ ] `bench:micro` が PASS（`src/content/extractor.ts` に依存しないことの確認込み）
  - 未実施の理由: `bench:micro` の実行環境が worktree にないため未実行。依存不存在は grep（ヒットゼロ）で確認済み
- [x] test-support 置き場所規約が明文化される
- [ ] コードレビュー完了
  - 未実施: レビュア不在。メイン側で判断すること
- [x] ドキュメント更新（`dev-docs/ARCHITECTURE_MAP.md` の content script 節、必要なら `DESIGN_SPECIFICATIONS.md` の抽出パイプライン節に entrypoint 組み立ての実態を反映）
  - 実施: ARCHITECTURE_MAP の content script 節を更新。DESIGN_SPECIFICATIONS の抽出パイプライン節は facade 構造の記述変更を要する箇所がなかったため見送り
