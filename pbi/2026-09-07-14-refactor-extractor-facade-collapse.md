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

- [ ] `getPageStateForTesting` / `__kernelForTesting` / `FakeScheduler` / `InMemoryDomainPolicyPort` が本番ファイルから除去され、規約で定めたテストヘルパ配置に移動する（または「未解決事項」2 の判断で本番ファイルに `@internal` で残す場合はその根拠を注記に明記）
- [ ] `src/utils/contentExtractor/optionBuilder.ts.bak` が削除される
- [ ] `createVisitGate` が単一実装になり、もう一方は import 参照になる
- [ ] `throttle` の3段ラッパーが縮約される（`contentKernel.throttle` の `init()` 自己利用分は残置可、縮約範囲を注記に明記）
- [ ] `showPrivacyConfirmDialog` の素通し re-export が解消される（呼び出し側が `privacyDialog.ts` を直接参照）
- [ ] `src/content/extractor.ts:169-194` のインラインリスナーが `handleGetContentMessage(msg, sender, sendResponse, deps)` 相当の名前付き・deps 注入関数に切り出され、clock も注入経路に載る
- [ ] GET_CONTENT ハンドラの単体テストが `vi.resetModules()` / `onMessage.addListener.mock.calls` からの引き抜きに依存しない形に書き換わる
- [ ] entrypoint（`entrypoints/content-extractor.ts`）が ContentKernel 組み立て + GET_CONTENT リスナー登録 + `init()` を直接行う形になる
- [ ] 振る舞いが変更前と同一（純粋リファクタリング）。既存 `extractor*.test.ts`（6ファイル）・`contentKernel.*.test.ts`・`loader*.test.ts` が import パス変更を除き無修正で green
- [ ] `CURRENT_PROTOCOL_VERSION` のビルド時注入前提が維持される
- [ ] `__OW_TEST_STATE` / `data-ow-test-state` 契約と `testDir/e2e/` が維持される
- [ ] ビルド出力名 `content-extractor.js` と `wxt.config.ts:104` の `web_accessible_resources` 登録が維持され、`loader.ts:73` の動的 import が成功する
- [ ] `bench/micro/*.bench.mjs` が `src/content/extractor.ts` の export に依存していないことを grep で確認（`index.ts` の string entry には依存してよい）
- [ ] `src/` の test-support 置き場所規約が短いドキュメント（または既存ドキュメントへの追記）として明文化される
- [ ] type-check / lint / build / `npm run validate` が PASS

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
   - `src/**/__tests__/support/` 案 / `src/test-support/`（本番 tsconfig 除外）案 / `*.testkit.ts` サフィックス案
   - PBI 34 の `InMemoryTransport` 判断と方針を揃える
2. **`FakeScheduler` / `InMemoryDomainPolicyPort` を移設 vs 本番ファイルに `@internal` で残す**（PBI 34 の `InMemoryTransport` 判断と同様の論点）
3. **`extractor.test.ts`（2000行超、GET_CONTENT 5 describe + リスナー引き抜きパターン）の書き換え規模**が Effort の主変動要因。着手時に実測して見積もりを更新する
4. **`throttle` 3段のうち `contentKernel.throttle` は完全には潰せない**。縮約範囲の見極め（extractor の re-export 層のみ削る、で確定してよいか）
5. `classifier.ts:105` の `@internal` export をこの PBI で扱うか、`index.ts` 非干渉の原則を優先して見送るか

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `extractor*.test.ts` / `contentKernel.*.test.ts` / `loader*.test.ts` が import パス変更を除き無修正で green
- [ ] `handleGetContentMessage` の新規単体テストが chrome guard の外で成立し、旧引き抜きテストが撤去される
- [ ] type-check / lint / build / `npm run validate` が PASS
- [ ] `npm run build` 後の E2E（`testDir/e2e/`）が green、`loader.ts:73` の動的 import が成功
- [ ] `bench:micro` が PASS（`src/content/extractor.ts` に依存しないことの確認込み）
- [ ] test-support 置き場所規約が明文化される
- [ ] コードレビュー完了
- [ ] ドキュメント更新（`dev-docs/ARCHITECTURE_MAP.md` の content script 節、必要なら `DESIGN_SPECIFICATIONS.md` の抽出パイプライン節に entrypoint 組み立ての実態を反映）
