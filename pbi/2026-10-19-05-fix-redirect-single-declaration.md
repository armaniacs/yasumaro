# PBI: redirect ポリシーの宣言を 1 箇所に戻す — systemHandlers のリテラル、後置 redirect による黙った上書き、実定数を見ないテストの解消

## ユーザーストーリー

この拡張機能を保守する開発者として、**「redirect を追従しない」という 1 つの方針が 1 箇所で宣言され、そこから外れる書き方を型または lint が拒否してほしい**、なぜなら AI 経路・Obsidian 経路・FETCH_URL 経路はどれも資格情報の保護か SSRF の防衛を同じ方針へ預けており、宣言が複数箇所に散るか後置代入で黙って上書きできる状態では、「片方の経路だけが抜け道になる」という事故を防ぐ仕組みが人の注意力だけに戻るから。現時点で誤動作は無いので、これは将来の変更で壊れないようにするための衛生作業である。

## 優先度

- 順位: 2026-10-19 の 05 / 08（同日 8 件のうち 5 番目）
- RICE: 400（Reach=200 / Impact=1 / Confidence=100% / Effort=0.5）
  - Reach: redirect 方針を共有する fetch サイトは 6 経路（AI 2 + Obsidian 3 + FETCH_URL 1）。これらの経路を持つ全プロファイルが対象で、保守時の変更対象として 200 と推定
  - Impact: 1。**現時点の誤動作は無い**（6 経路すべてが実行時には `redirect: 'error'` を渡す）。効くのは将来の変更に対する防護
  - Confidence: 100%（定数・5 サイトの先頭 spread・systemHandlers のリテラル・モック 16 ファイルをコード上で確定済み）
  - Effort: 0.5 SP。リテラル 1 箇所の置換、型 seam の追加、pin テスト 1 本、モックの寄せ
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟢なし（型・lint・定数の共有のみ。production の挙動は変えない）
- 根拠: 同点（400）の 2026-10-19-04 とは「リスク軽減効果」で順序を決めた（04 は security control の実効性を検証するため上位）

## 背景（発見の経緯）

PBI [2026-10-18-01](../dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md) / [2026-10-18-08](../dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md) で AI 経路と Obsidian 経路に `redirect: 'error'` を適用し、共通 seam として `NO_REDIRECT_FETCH_POLICY` を導入した。PBI [2026-10-19-06](2026-10-19-06-fix-gist-tranco-redirect-policy.md) が gist / tranco の 5 サイトへ同じ seam を展開する予定である。

その展開を準備する過程で、**seam が「宣言は 1 箇所」という主張を満たしていない**ことが分かった。ADR [2026-08-29-fetch-redirect-policy.md](../dev-docs/ADR/2026-08-29-fetch-redirect-policy.md) の `:90-93` にも既に記載がある。誤動作ではないが、方針の SSOT が実質 2 箇所に分かれ、しかも片方は後置代入で黙って上書きできる。

### 機構（コード上で確定）

1. 定数は `src/utils/fetch.ts:73` の `export const NO_REDIRECT_FETCH_POLICY = { redirect: 'error' } as const;`。`:61-72` のコメントは「`fetchWithTimeout` は残りの fetchOptions と一緒にこの値を platform fetch へ素通しするので、呼び出し側はこの定数を spread するだけでよい。片方の経路だけに適用すると、同じ資格情報を持つもう一方が抜け道として残る」と宣言の一元化を掲げている。
2. 定数を使う 5 サイトは**すべてオプションオブジェクトの先頭で spread** している: `src/background/ai/providers/HttpProviderStrategy.ts:246` / `:315`、`src/background/obsidianClient.ts:276` / `:318` / `:370`。
   - 先頭 spread は後続のプロパティに負ける。同じリテラルの後ろに `redirect: 'follow'` を書けば**黙って上書きされる**。型でも lint でも止まらない。
   - とくに `obsidianClient.ts:370` は `const requestOptions: RequestInit = { ... }` と**広い型で受けている**ため、上書きを検出する手掛かりが無い。
3. `src/background/handlers/systemHandlers.ts:104` は `redirect: 'error'` を**リテラルで**持ち、定数を共有していない（挙動は正しい）。定数のコメントが掲げる「片方の経路だけでは抜け道になる／宣言は 1 箇所」という整理は、厳密にはまだ成り立っていない。
4. テストが**実定数の値を見ていない**。`src/background/ai/providers/__tests__/httpSummaryFlow.test.ts:24` と `httpTestFlow.test.ts:43` は `utils/fetch.js` をモックして `{ redirect: 'error' }` を自前で書いており、`src/utils/__tests__/fetch.test.ts:227` も自前リテラルを渡している。定数の値を変えたときに検知できるのは、`utils/fetch.js` をモックせず実モジュールを使う Obsidian 側のテストだけである（`obsidianClient.test.ts` / `obsidianClient-ipv6.test.ts` / `obsidianClient-failureTaxonomy.test.ts` などは実モジュールを読む）。
5. `NO_REDIRECT_FETCH_POLICY` をモックファクトリ内で export しているテストは **16 ファイル**（実測）。Vitest は存在しない named export を参照すると throw するため、いずれも「実定数を参照する」代わりに自前リテラルを置いている。

## 影響

- 現時点の production 挙動は正しい。6 経路すべてが実行時に `redirect: 'error'` を渡している。
- 将来のリスクは 3 つ。
  1. **定数の値変更が一部経路へ伝わらない**: `NO_REDIRECT_FETCH_POLICY` を `{ redirect: 'manual' }` などへ変えたとき、5 サイトは追随するが `systemHandlers.ts` は追随しない。逆に `systemHandlers.ts` を直して定数を放置すると、今度は AI / Obsidian 経路が旧方針で残る。
  2. **後置上書きが無音**: `{ ...NO_REDIRECT_FETCH_POLICY, redirect: 'follow' }` は実行時に方針を反転させるが、レビューで気付く手段が読解だけになる。ADR が塞いだ VULN-016（30x 経由の内部宛先への到達）が、この 1 行で戻る。
  3. **テストが実定数を見ていない**: 定数を変えても AI 経路のモックは自前リテラルのままなので緑のまま通る。回帰ガードが実質的に Obsidian 経路だけに片寄っている。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 6 経路すべてが同じ宣言由来の redirect 方針を渡す（正常経路）
  Given NO_REDIRECT_FETCH_POLICY が唯一の宣言であり、systemHandlers もこれを共有している
  When  AI 経路（要約・接続テスト）/ Obsidian 経路（既存ノート読み出し・書き込み・接続確認）/
        FETCH_URL 経路が fetch を発行する
  Then  6 経路すべてが platform fetch へ redirect: 'error' を渡す
  And   systemHandlers.ts に redirect: 'error' のリテラルが残っていない

Scenario: 2. 後置の redirect 上書きが型または lint で拒否される（境界・本 PBI の中心）
  Given 共通 seam を spread したオプションリテラルがある
  When  同じリテラルの後ろに redirect: 'follow' を書く
  Then  型（Omit<RequestInit, 'redirect'> を注入型にした seam）または lint ルールが拒否する
  And   正しい形（spread のみ、上書き無し）は受理される

Scenario: 3. 200 の正常経路は不変（回帰ガード）
  Given 各経路の fetch が 200 を返す
  When  それぞれの処理が完走する
  Then  応答の採用・本文の読み出し・成功判定は本 PBI の変更前と同じ結果になる

Scenario: 4. 定数の値を変えたらテストが検知する
  Given 実定数の値を pin するテストがある
  When  NO_REDIRECT_FETCH_POLICY の値を書き換える
  Then  pin テストが失敗する
  And   モックを使う AI 経路のテストも、実定数を参照していれば追随して失敗する
```

## 受け入れ基準

- [ ] `src/background/handlers/systemHandlers.ts` が `NO_REDIRECT_FETCH_POLICY` を import して spread し、`redirect: 'error'` のリテラルを持たない
- [ ] `{ ...NO_REDIRECT_FETCH_POLICY, redirect: 'follow' }` に相当する後置上書きが、**型または lint ルールで拒否される**（採用した手段と理由、および拒否されることを確認した出力を完了記録に残す）
- [ ] 拒否の手段を型にする場合、正しい形（spread のみ）は型エラーにならない
- [ ] `NO_REDIRECT_FETCH_POLICY` の実値（`redirect === 'error'`）を pin するテストが 1 本以上ある
- [ ] 6 経路（AI 2 / Obsidian 3 / FETCH_URL 1）が同じ宣言由来の値を渡すことをテストで固定する。`systemHandlers` の既存アサーション（`systemHandlers.test.ts:154-171`）は「ハンドラが定数を共有している」ことが分かる形へ寄せる
- [ ] テストのモックファクトリは `NO_REDIRECT_FETCH_POLICY` の **export 名を維持**し、可能な範囲で `importActual` / `importOriginal` により実定数を参照する（自前リテラルを残さない）
- [ ] `FetchOptions` / `fetchWithTimeout` / `fetchWithRetry` / `fetchWithRedirectGuard` の型関係を壊さない（とくに `fetchWithRedirectGuard` は `redirect: 'manual'` を正当に渡すため、`FetchOptions` 全体を狭めない）
- [ ] 200 の正常経路が非退行（各経路の既存テストが緑）
- [ ] `npm run validate` が緑。`npm run type-check` が後置上書きを検出することを確認済み
- [ ] production の挙動を変えない（送信される `redirect` の値は変更前と同一）

## テスト戦略

- **単体（定数の pin）**: `src/utils/__tests__/fetch.test.ts` に、実モジュールから import した `NO_REDIRECT_FETCH_POLICY.redirect` が `'error'` であることを固定する 1 本を足す。既存の `:227` のテストは自前リテラルを渡しているので、渡す値を実定数へ寄せる。
- **単体（後置上書きの拒否）**: 型で防ぐ場合、拒否は `npx tsc --noEmit` が検出する形で確認する。型テストは `testDir` 側の tsconfig（`npm run type-check:test`）に載るファイルへ置き、`// @ts-expect-error` で「後置上書きは型エラーになる」ことを固定する（同ディレクティブはエラーが消えると tsc が失敗するため、両方向のガードになる）。lint で防ぐ場合は `eslint/__tests__` にルールテストを足す（`createRepeatSafeRuleTester` を使う）。
- **統合（モックの寄せ）**: `httpSummaryFlow.test.ts` / `httpTestFlow.test.ts` の `vi.mock('../../../../utils/fetch.js', ...)` を `importOriginal` で実モジュールを取り込み、`NO_REDIRECT_FETCH_POLICY` だけ実値を使う形にする。これで定数変更が AI 経路のテストにも伝わる。
- **回帰**: 6 経路の既存テスト（`systemHandlers.test.ts`、`obsidianClient*.test.ts`、`HttpProviderStrategy` 系）をそのまま緑に保つ。とくに 200 応答を扱うテストが非退行であることを確認する。
- **E2E**: 不要（型・定数の共有のみで、実行時の送信内容を変えない）。ただし型を採用した場合、`npm run type-check` の出力を完了記録に貼る。

## 実装メモ（実装者向け）

### 対象ファイルと該当箇所

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/fetch.ts` | 61-72 | 定数のコメント。「宣言は 1 箇所」と書いてある |
| `src/utils/fetch.ts` | 73 | `NO_REDIRECT_FETCH_POLICY`（`as const`、`redirect: 'error'` の literal 型） |
| `src/utils/fetch.ts` | 75-82 | `FetchOptions extends RequestInit`（module-private、export されていない） |
| `src/utils/fetch.ts` | 115 / 169 | `fetchWithTimeout` と、`...fetchOptions` を platform fetch へ渡す行 |
| `src/utils/fetch.ts` | 215-229 | `fetchWithRedirectGuard`。`:227` で `redirect: 'manual'` を渡す（狭めてはいけない側） |
| `src/utils/fetch.ts` | 374-376 | `fetchWithRetry`（`options: FetchOptions`） |
| `src/background/handlers/systemHandlers.ts` | 104 | `redirect: 'error'` のリテラル。定数を共有していない |
| `src/background/ai/providers/HttpProviderStrategy.ts` | 246 / 315 | 先頭 spread の 2 サイト |
| `src/background/obsidianClient.ts` | 276 / 318 / 370 | 先頭 spread の 3 サイト。`:370` は `RequestInit` で受ける |
| `src/utils/__tests__/fetch.test.ts` | 227-240 | 自前リテラルを渡す透過テスト |
| `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts` | 21-28 | モックファクトリ（自前リテラル） |
| `src/background/ai/providers/__tests__/httpTestFlow.test.ts` | 39-47 | モックファクトリ（自前リテラル） |
| `src/background/handlers/__tests__/systemHandlers.test.ts` | 154-171 | `opts.redirect === 'error'` のアサーション |
| `eslint/rules/` / `eslint/plugin.mjs` / `eslint.config.js` | — | lint ルールを採る場合の追加先 |

`NO_REDIRECT_FETCH_POLICY: { redirect: 'error' }` を自前で持つテストは 16 ファイル（実測）:

```
src/background/__tests__/GeminiProvider.test.ts:15
src/background/__tests__/aiClient-timeout.test.ts:4
src/background/__tests__/obsidianClientLogIntegrity.test.ts:14
src/background/__tests__/connectionTest-real-inference.test.ts:24
src/background/__tests__/OpenAIProvider.test.ts:15
src/background/ai/__tests__/providerRegistry.test.ts:27
src/background/ai/providers/__tests__/httpHooksUnified.test.ts:17
src/background/ai/providers/__tests__/OpenAIProvider-branches.test.ts:23
src/background/ai/providers/__tests__/httpSummaryFlow.test.ts:24
src/background/ai/providers/__tests__/httpTestFlow.test.ts:43
src/background/ai/providers/__tests__/resolvedProviderSettings.test.ts:24
src/background/ai/providers/__tests__/OpenAIProvider.test.ts:23
src/background/ai/providers/__tests__/aiExtract-twins-parity.test.ts:43
src/background/ai/providers/__tests__/OpenAIProvider-apiKeyGate.test.ts:23
src/background/ai/providers/__tests__/providerParity.test.ts:36
src/background/ai/providers/__tests__/apiKeyLocked.test.ts:25
```

### 実装手順

1. **`systemHandlers.ts` を定数共有へ寄せる**（宣言を 1 箇所へ）。`:104` の `redirect: 'error',` を削り、オプションオブジェクトの先頭で `...NO_REDIRECT_FETCH_POLICY` を spread する。`:99-101` のコメントは「ADR の決定は `NO_REDIRECT_FETCH_POLICY` に集約済み」と要約し、ADR への参照は残す。
2. **後置上書きを止める seam を 1 つ入れる**（型を推奨）。`src/utils/fetch.ts` へ次を足す。

   ```ts
   /** 先頭 spread 済みの redirect 方針を後置で上書きさせないための注入型。 */
   export function noRedirectInit(options: Omit<RequestInit, 'redirect'> = {}): RequestInit {
     return { ...NO_REDIRECT_FETCH_POLICY, ...options };
   }
   ```

   - 呼び出し側は `fetchWithTimeout(url, noRedirectInit({ method: 'GET', headers }), timeout)` の形にする。引数リテラルに `redirect:` を書くと **excess property check** で落ちる（下記「確認済み」参照）。
   - 6 サイトすべてをこの形へ寄せると、spread の書き忘れも同時に消える。
   - 5 サイトの既存 spread をそのまま残す最小案もある（各リテラルを `Omit<RequestInit, 'redirect'>` で受ける）。ただし `obsidianClient.ts:370` の `const requestOptions: RequestInit` は `Omit<RequestInit, 'redirect'>` へ狭める必要がある。
3. **`FetchOptions` を全体として狭めない。** `fetchWithRedirectGuard`（`:227`）は `redirect: 'manual'` を正当に渡す。`FetchOptions['redirect']` を `'error'` だけに絞ると `:227` が型エラーになり、SSRF ガードの経路を壊す。
4. **pin テストを足す**（`src/utils/__tests__/fetch.test.ts`）。`import { NO_REDIRECT_FETCH_POLICY } from '../fetch.js'` して `expect(NO_REDIRECT_FETCH_POLICY.redirect).toBe('error')`。あわせて `:227` のテストが渡す `redirect: 'error'` を実定数の spread に置き換える。
5. **型で拒否することを固定する**。`testDir` 側に型テストを 1 本置き、`// @ts-expect-error` を付けた `noRedirectInit({ redirect: 'follow' })` が `npm run type-check:test` で検出されることを確認する。
6. **AI 経路のモックを実定数へ寄せる**。`httpSummaryFlow.test.ts:21-28` と `httpTestFlow.test.ts:39-47` の `vi.mock('../../../../utils/fetch.js', () => ({...}))` を、`importOriginal` で実モジュールを取り込む非同期ファクトリへ変え、`NO_REDIRECT_FETCH_POLICY` だけ実値を再 export する。他の 14 ファイルは export 名を維持したまま、余力の範囲で同じ形へ寄せる。
7. **lint を採る場合**（代替案 B）: `eslint/rules/no-redirect-override.mjs` を追加し、`NO_REDIRECT_FETCH_POLICY` の spread を含む ObjectExpression 内に `redirect` プロパティがあれば報告する。`eslint/plugin.mjs` へ登録し、`eslint.config.js` から有効化し、`eslint/__tests__` にルールテストを足す。型で足りるならルールを増やさない（型は tsc が、lint は `npm run validate` が見るが、ルール追加は保守対象を 1 つ増やす）。
8. **`npm run validate` と `npm run type-check` を通す**。

**確認済み（2026-10-19、scratch ファイルを tsc に掛けて実測）**: `Omit<RequestInit, 'redirect'>` を注入型にすると、後置の `redirect: 'follow'` は `error TS2353: Object literal may only specify known properties, and 'redirect' does not exist in type 'Omit<RequestInit, "redirect">'` で落ち、正しい形（spread のみ）は落ちない。ヘルパ関数の引数でも同じく落ちる。

### 実装者向け注記 — 現状コードの確認（着手前に必ず実行）

```bash
# 1) 定数の宣言は 1 箇所か（期待: fetch.ts:73 のみ。テストのモックは 16 件出る）
grep -rn "NO_REDIRECT_FETCH_POLICY" --include=*.ts src | grep -v node_modules

# 2) redirect のリテラルが残っている場所（期待: systemHandlers.ts:104 とテスト）
grep -rn "redirect: 'error'" --include=*.ts src

# 3) 5 サイトが先頭 spread であること（期待: 246 / 315 / 276 / 318 / 370 の spread 行）
grep -rn "\.\.\.NO_REDIRECT_FETCH_POLICY" --include=*.ts src

# 4) 狭めてはいけない側（期待: fetch.ts:227 の redirect: 'manual'）
grep -n "redirect: 'manual'" src/utils/fetch.ts

# 5) 参照する型（期待: FetchOptions は export されていない / RequestInit を extends）
sed -n '75,82p' src/utils/fetch.ts
```

**未修正である**（2026-10-19 に `grep` と `tsc` で確定。`systemHandlers.ts:104` はリテラルのまま、後置上書きは型エラーにならない）。

### 落とし穴

- **`FetchOptions` を狭めると `fetchWithRedirectGuard` が壊れる**。`:227` は `redirect: 'manual'` を渡す。狭めるのは「定数を注入する seam」だけにする。
- **`NO_REDIRECT_FETCH_POLICY` は `as const`** なので `redirect` の型は `'error'` の literal 型。`FetchOptions`（`RequestInit` を extends）との関係を壊さないこと。`Omit<RequestInit, 'redirect'>` は `redirect` が optional のため `RequestInit` へ代入でき、`FetchOptions` へもそのまま渡せる。
- **`obsidianClient.ts:370` の `const requestOptions: RequestInit`** は広い型で受けており、この 1 行だけが後置上書きを無音にする。最小案を採る場合はこの注記も狭める。
- **`fetchWithTimeout` は残りのオプションを `...fetchOptions` で platform `fetch` へ渡す**（`src/utils/fetch.ts:169`）。型を絞っても実行時の送信内容は変わらない。逆に言えば、型を絞っただけで runtime が変わることは無いので、送信値の検証はテストで行う。
- **モックの export 名を変えない**。Vitest はモジュールを差し替えたうえで存在しない named export を参照すると throw するため、16 ファイルが `NO_REDIRECT_FETCH_POLICY` を自前で export している。`importOriginal` へ寄せる場合も同名で返す。
- **`importOriginal` を非同期ファクトリで使うと、モジュールの実体を読み込むぶんテストのコストが増える**。Vitest のフープ制約（ファクトリ外の変数を参照できない）に注意し、必要な値だけを返す。
- **`systemHandlers.test.ts:154-171` は `opts.redirect` を直接見ている**。定数を共有した後もこのアサーションは緑になるが、定数変更を検知できる形（実定数と比較する）へ寄せると pin テストと役割が重複しない。`local/no-tautology-expect` に触れないよう、期待値を自前リテラルで書かない。
- **`redirect: 'error'` を消しても `response.redirected` の多重防衛は残す**。`redirect: 'error'` は platform fetch が 30x で reject する設定であり、`redirected` チェックはその後に来る多重防衛。片方だけにしない。
- ADR の `:90-93` は「systemHandlers が定数を共有していない」と記載済み。本 PBI 完了時に当該節を「適用済み」へ更新する（ドキュメント側の追随）。

### ロールバック手順

1. `systemHandlers.ts` の spread 化は 1 箇所なので `git revert` で戻せる（リテラルへ戻る。挙動は同一）。
2. `noRedirectInit` を入れた場合、revert で 6 サイトの呼び出しが元の spread 形へ戻る。関数を残したまま呼び出しだけ戻しても挙動は同一（未使用 export が lint で警告される場合は関数も一緒に戻す）。
3. 型テスト（`@ts-expect-error`）を戻すと後置上書きの検出が失われ、pin テストを戻すと定数変更の検知が Obsidian 経路だけに戻る。いずれも「未修正に戻る」だけで、実行時の挙動は変わらない。
4. revert 後に `npm run validate` で緑を確認し、`pbi/00-INDEX.md` の状態も戻す。

## 見積もり

0.5 SP（🟢低）。内訳: `systemHandlers.ts` の定数共有 = 0.1 / 型 seam（または lint ルール）と拒否の確認 = 0.2 / pin テストとモックの寄せ = 0.2。lint ルールを採る場合は +0.3 SP。

## Definition of Done

- [ ] BDDシナリオ 1〜4 が自動テストで実装されパス
- [ ] `systemHandlers.ts` が `NO_REDIRECT_FETCH_POLICY` を共有している
- [ ] 後置上書きを拒否する手段を採用し、その手段と理由が完了記録に残っている
- [ ] 実定数の値を pin するテストが 1 本以上ある
- [ ] `npm run validate` が緑。既存テストが非退行
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（ADR `2026-08-29-fetch-redirect-policy.md` の `:90-93` を適用済みへ、必要なら `src/utils/fetch.ts:61-72` のコメントを seam の説明へ更新）
- [ ] `pbi/00-INDEX.md` の本 PBI の状態を更新

## 関連

- `pbi/00-INDEX.md`
- [2026-10-19-04-fix-redirect-real-behavior-e2e.md](../dev-docs/archived/pbi/2026-10-19-04-fix-redirect-real-behavior-e2e.md) — 同点（400）。security control の実効性検証を担うため上位（2026-10-19 完了・アーカイブ済み。実測済みの E2E フィクスチャは本 PBI の検証にも使える）
- `pbi/2026-10-19-06-fix-gist-tranco-redirect-policy.md` — 同じ seam を gist / tranco の 5 サイトへ展開する。本 PBI の型 seam はその受け皿になる
- `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` — `:90-93` に systemHandlers が定数を共有していない旨を記載済み
- `dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` — 共通 seam を導入した PBI（AI 経路）
- `dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md` — 同じ seam を Obsidian 経路へ広げた PBI
