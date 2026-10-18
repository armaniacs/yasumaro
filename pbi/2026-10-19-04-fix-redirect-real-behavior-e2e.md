# PBI: redirect 拒否（`redirect:'error'`）の実挙動を E2E で実測し、Obsidian 接続テストにも `redirected` ガードを揃える

## ユーザーストーリー

資格情報とノート本文を保存先へ送るユーザーとして、**許可済みの宛先が 30x を返しても 2 次リクエストが 1 件も発行されないこと**が実測で保証されてほしい、なぜなら `redirect:'error'` は「事前ホップのゲートだけを通過した宛先から未検証アドレスへ転送させない」ための security control であり、現状のテストは「オプションが渡されたこと」しか固定していないため。オプションの受け渡しが将来のリファクタで壊れても、テストは緑のまま転送が復活しうる。加えて Obsidian 接続テスト経路には read / write と対になる `response.redirected` ガードが無く、多層防御が片側だけになっている。

## 優先度

- 順位: 2026-10-19 の 04 / 08（同日 8 件のうち 4 番目）
- RICE: 400（Reach=400 / Impact=2 / Confidence=100% / Effort=2.0）
  - Reach: 資格情報と本文を外部へ送る全経路（AI 要約・AI 接続テスト・Obsidian read / write / 接続テスト）を使う母数を 400 と推定
  - Impact: 2。実害はまだ観測されていない（`redirect:'error'` は全経路に入っている）。ただし control の「実挙動」が未検証で、退行を検知できない状態が続く
  - Effort: 2.0 SP。E2E フィクスチャ（30x を返すローカルサーバ）＋ 接続テストの対称ガード ＋ 既存テストの追随
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🟡軽微（E2E フィクスチャの追加のみ。production の挙動は変えない。ただし接続テストに `redirected` ガードを足す分だけ production 差分が出る）
- 根拠: リダイレクト拒否は security control なのに、現状のテストは「オプションが渡されたこと」しか固定しておらず、**30x で実際に 2 次リクエストが発行されないことを検証したテストが 1 件も無い**

## 背景（発見の経緯）

PBI [2026-10-18-01](../dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md)（AI 経路）と [2026-10-18-08](../dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md)（Obsidian 経路）で、`redirect:'error'` は共通 seam `NO_REDIRECT_FETCH_POLICY`（`src/utils/fetch.ts`）として全対象経路へ適用済み。両 PBI の完了記録に、**「30x 実測の不在」が残存リスクとして既に記載されている**。

### 確定している事実（2026-10-19 時点のコードで確認）

1. 追加済みテストは mock transport が受け取った `init.redirect === 'error'` を pin するだけ: `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts:216`、`src/background/ai/providers/__tests__/httpTestFlow.test.ts:205`、`src/background/__tests__/obsidianClient-secure-fetch.test.ts:273`。
2. `src/background/ai/providers/__tests__` と `src/background/__tests__/obsidianClient*.test.ts` を 307 / 301 / 302 / 308 で grep してもヒットが無く、`testDir/e2e` にも redirect を扱う spec が無い。
3. plain な fetch mock ではブラウザの abort（`redirect:'error'` は Response を返す前に reject する）を再現できないため、**挙動の検証は実ブラウザ / E2E でしかできない**。
4. 多層防御の `response.redirected` ガードは Obsidian の read / write には入っている（`src/background/obsidianClient.ts:281` と `:324`）が、**接続テスト経路（`_fetchConnectionResponse`、同 `:370` 付近で fetch し `:378` 付近）には入っていない**（非対称）。また `redirect:'error'` が有効な限りこのガードは到達しない（設計どおりの defence in depth）ので、実リダイレクト応答を拒否できることは E2E でしか確かめられない。
5. 参考: 対象経路は AI 要約（`HttpProviderStrategy.ts:246`）、AI 接続テスト（同 `:315`）、Obsidian の read / write / 接続テスト（`obsidianClient.ts:276 / 318 / 370`）。

## 影響

- **control の退行を検知できない**: `NO_REDIRECT_FETCH_POLICY` の spread が将来の編集で抜けても、実リダイレクトを流すテストが無いため緑のまま通過する。気づく手段は本番事故か監査の再実施だけ。
- **多層防御が片側だけ**: 接続テスト経路に `redirected` ガードが無い。`redirect:'error'` が主防御である限り実害は無いが、platform 実装差や将来のオプション変更があった場合に read / write と挙動がずれる。
- **ADR の適用範囲と実装の乖離**: `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` はポリシーの存在を定めるが、「30x を実際に拒否した」という実測記録は無い。
- **テスト戦略の未完**: 元 PBI 01 / 08 のテスト戦略に書かれた「307 を再現して fetch URL が 1 件だけであること」が未実装のまま残っている。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 許可済みプロバイダが 30x を返しても 2 次リクエストが発行されない（E2E 実測）
  Given redirect:'error' 方針が適用された AI 要約経路があり、許可済みプロバイダの 1 つが 307 を Location 付きで返す
  When  そのプロバイダへ要約リクエストを 1 回送る
  Then  転送先への 2 次リクエストは発行されない
  And   観測されたリクエストは当初 URL への 1 件だけである
  And   失敗は transport failure として扱われ、再送される場合も当初 URL のみである

Scenario: 2. redirected:true の応答を接続テストが本文として採用しない（境界）
  Given Obsidian 接続テスト経路の fetch が redirected:true かつ ok:true の応答を返す
  When  接続テストを実行する
  Then  その応答は成功として採用されない
  And   接続は確立していないものとして扱われる（本文を読まない）

Scenario: 3. 200 の正常経路が変わらない（回帰ガード）
  Given 許可済みプロバイダが 200 と正常な本文を返す
  When  要約リクエストを送る
  Then  要約が成功し、リクエストは 1 件だけである
  And   Obsidian 接続テストが 200 を返す宛先に対しては成功を返す

Scenario: 4. Obsidian の read / write も 30x で 2 次リクエストを発行しない
  Given 保存済み vault origin が 301 を Location 付きで返す
  When  ノートの read または write を 1 回実行する
  Then  転送先への 2 次リクエストは発行されない
  And   Authorization ヘッダーとノート本文が転送先へ送られない
```

## 受け入れ基準

- [ ] 30x を返すフィクスチャで「発行されたリクエストが当初 URL の 1 件だけ」であることを実測で固定する（E2E）
- [ ] `redirect:'error'` の reject が transport failure として届き、再送された場合も宛先が当初 URL のみであることを固定する
- [ ] 接続テスト経路（`_fetchConnectionResponse` の消費側）に対称な `response.redirected` ガードを入れる。入れる場合は既存テストの期待値への影響を確認し、影響があるテストを同時に更新する
- [ ] 200 の正常経路が変わらないこと（AI 要約・AI 接続テスト・Obsidian 接続テスト）を回帰として固定する
- [ ] ブラウザでしか検証できない部分が何かを完了記録に明記する（plain な fetch mock で再現できない範囲を列挙する）
- [ ] `npm run validate` が緑
- [ ] `npx playwright test <対象 spec> --repeat-each=10 --retries=0` が安定（AGENTS.md の「タイミング修正の DoD」に従う）
- [ ] 既存 pin テスト（`httpSummaryFlow.test.ts:216` / `httpTestFlow.test.ts:205` / `obsidianClient-secure-fetch.test.ts:273`）が非退行

## テスト戦略

- **E2E（主）**: Playwright（`testDir/e2e`、設定は `testDir/playwright.config.ts`）。30x を返すローカルサーバまたは route 傍受でリダイレクトを再現し、**観測されたリクエスト一覧が当初 URL の 1 件だけ**であることを assert する。ローカルサーバは `testDir/e2e/fixtures/localServers.ts` の `pickLoopbackPort` / `listenHttp` を再利用し、readiness は上限つきポーリングで待つ。
- **統合**: Obsidian 接続テストの呼び出し経路（`_fetchConnectionResponse` → `response.ok` 判定）を通し、`redirected:true` の応答が成功として採用されないことを固定する。
- **単体**: 既存 pin（`init.redirect === 'error'`）の非退行のみ。実ブラウザの abort は再現しないため、単体で挙動を主張しない。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/background/ai/providers/HttpProviderStrategy.ts` | 246 | AI 要約の `fetchWithRetry`。`NO_REDIRECT_FETCH_POLICY` を展開済み |
| `src/background/ai/providers/HttpProviderStrategy.ts` | 315 | AI 接続テストの `fetchWithRetry`。同上 |
| `src/background/obsidianClient.ts` | 276 / 318 / 370 | Obsidian read / write / 接続テストの fetch。`NO_REDIRECT_FETCH_POLICY` を展開済み |
| `src/background/obsidianClient.ts` | 281 | read の `response.redirected` ガード（多層防御。対称性の正解例） |
| `src/background/obsidianClient.ts` | 324 | write の `response.redirected` ガード（同上） |
| `src/background/obsidianClient.ts` | 362-395 | `_fetchConnectionResponse`。`redirected` ガードが無い（非対称の本体） |
| `src/background/obsidianClient.ts` | 425 | 接続テスト本体。戻り値を `response.ok` で成功判定する消費側 |
| `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts` | 216 | `init.redirect === 'error'` の pin のみ |
| `src/background/ai/providers/__tests__/httpTestFlow.test.ts` | 205 | 同上 |
| `src/background/__tests__/obsidianClient-secure-fetch.test.ts` | 273 | read / write の pin |
| `testDir/e2e/fixtures/localServers.ts` | 37 / 57 | `pickLoopbackPort` / `listenHttp`。30x サーバの起動に再利用 |
| `testDir/playwright.config.ts` | — | E2E 設定（`testDir` 配下） |

### 実装手順

1. **E2E フィクスチャ**: 30x（301 / 302 / 307 / 308 のいずれか）を `Location` 付きで返すローカルサーバを `testDir/e2e/fixtures/` に追加する。リクエストの記録（メソッド・URL・Authorization の有無）を返す口を用意し、テストから件数と宛先を assert できるようにする。
2. **E2E spec（シナリオ 1 / 4）**: 許可済み経路から 30x を踏ませ、記録されたリクエストが当初 URL の 1 件だけであることを固定する。再送が起きる場合も宛先が当初 URL のみであることを併せて固定する。
3. **接続テストの対称ガード（シナリオ 2）**: `_fetchConnectionResponse` の消費側（`:425` 付近）で `response.redirected` を成功条件から除外する。read / write の既存ガード（`:281` / `:324`）と同じ姿勢に揃える。既存の接続テスト関連テストの期待値を確認し、必要なら同時に更新する。
4. **回帰ガード（シナリオ 3）**: 200 正常経路が 1 件のリクエストで成功することを固定する。
5. **検証**: `npm run validate` を通し、対象 spec を `--repeat-each=10 --retries=0` で反復する。

### 実装者向け注記 — 現状コードの確認（着手前に必ず実行）

```bash
# 追加済みテストが「オプションが渡されたこと」だけを pin していること
grep -n "redirect" src/background/ai/providers/__tests__/httpSummaryFlow.test.ts src/background/ai/providers/__tests__/httpTestFlow.test.ts src/background/__tests__/obsidianClient-secure-fetch.test.ts

# 30x / redirected を扱うテストが 1 件も無いこと（期待: ヒット無し）
grep -rn "30[1278]\|redirected" src/background/ai/providers/__tests__ src/background/__tests__/obsidianClient*.test.ts

# E2E に redirect を扱う spec が無いこと（期待: ヒット無し）
grep -rln "redirect" testDir/e2e

# read / write には redirected ガードがあり、接続テスト経路には無いこと
grep -n "redirected\|_fetchConnectionResponse" src/background/obsidianClient.ts
```

**未実装**（テストの追加は「オプションの pin」までで、挙動の実測は存在しない）。

### 落とし穴

- **固定待機でリダイレクトを待たない**こと（AGENTS.md が禁止）。retry backoff や 30x の到達は、`expect.poll` かサーバ側の記録口の Promise を待って判定する。`page.waitForTimeout` / `setTimeout` に頼らない。
- E2E で実サーバを使う場合、`redirect:'error'` の reject は `TypeError: Failed to fetch` として届き、既存の transport failure（`LEGACY_TRANSPORT_MARKERS_FULL`）に一致するため retry 経路に入る（再送は当初 URL のみ）。したがって「リクエスト総数 = 1」ではなく「**転送先 URL へのリクエストが 0 件**」を主の assert にする。当初 URL への再送は仕様どおり。
- 接続テストに `redirected` ガードを足すと、`redirected:true` を注入する既存テストの期待が変わりうる。`:370` の `NO_REDIRECT_FETCH_POLICY` はそのままで、判定側（`:425` 付近）を触ることを意識する。
- route 傍受（`page.route`）はブラウザ内部のリダイレクト処理を置き換えることがあるため、**`redirect:'error'` の実 abort を検証できるのは実サーバ経路だけ**になりうる。傍受で済ませる場合は、何が検証できていないかを完了記録に書く。
- ローカルサーバの readiness を `sleep` で待たない。`testDir/e2e/fixtures/localServers.ts` の `listenHttp` のように「bind 成功と失敗の両方」を await する形を使う。
- E2E の安定性確認は `npx playwright test <対象 spec> --repeat-each=10 --retries=0 --workers=4` を DoD に含める（1 回の緑では完了としない）。
- 既存の pin テストは実定数の値ではなく自前リテラルを見ているものがある。実定数（`NO_REDIRECT_FETCH_POLICY`）の値変更を検知できるテストがどれかは、元 PBI の残存リスクに記載がある。本 PBI の射程外として扱い、必要なら別 PBI に切る。

### ロールバック手順

1. E2E フィクスチャと spec の追加はテスト専用なので、`git revert` で production に影響なく戻せる（`testDir/e2e` 配下のみが消える）。
2. 接続テストの `redirected` ガードを戻す場合、`_fetchConnectionResponse` の消費側の数行を revert する。戻すと非対称（read / write のみガード）に戻るだけで、`redirect:'error'` が主防御として残るため実害は無い。
3. revert 後に `npm run validate` が緑であることを確認する。既存 pin テストは変更しない方針のため、通常は据え置きで通る。
4. 本 PBI の verdict は「実測の追加」であるため、revert した場合は `pbi/00-INDEX.md` の状態も未着手に戻す。

## 見積もり

2.0 SP（🟡中）。内訳: E2E フィクスチャ（30x サーバとリクエスト記録）= 0.7 / E2E spec（シナリオ 1・4 と安定性確認）= 0.7 / 接続テストの対称ガードと既存テスト追随 = 0.4 / 完了記録（ブラウザ依存範囲の明記）= 0.2。

## Definition of Done

- [ ] BDDシナリオ 1〜4 が自動テストで実装されパス
- [ ] E2E で「転送先 URL へのリクエストが 0 件」を実測で固定している
- [ ] `npx playwright test <対象 spec> --repeat-each=10 --retries=0 --workers=4` が全回パス
- [ ] `npm run validate` が緑
- [ ] 接続テストの `redirected` ガードの採否と、採る場合の既存テストへの影響が完了記録に残っている
- [ ] ブラウザでしか検証できない範囲が完了記録に明記されている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` に実測の記録を追記。接続テストのガードを足す場合は `obsidianClient.ts` のコメントを対称に揃える）
- [ ] 完了時に `dev-docs/archived/pbi/2026-10-18-01-*` / `...-08-*` の「残存リスク」から本 PBI へ参照を張り替える

## 関連

- `pbi/00-INDEX.md`
- `pbi/2026-10-19-05-fix-redirect-single-declaration.md` — 同じ `redirect` 方針の宣言箇所を 1 つに寄せる隣接 PBI。本 PBI はその宣言が実挙動として効いていることを測る
- `pbi/2026-10-19-06-fix-gist-tranco-redirect-policy.md` — 同一クラスの未適用経路（gist / tranco）。本 PBI の E2E フィクスチャはそちらでも再利用できる
- `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` — `redirect:'error'` 方針の原本。適用範囲と決定理由
- `dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` — AI 経路の修正。完了記録に「30x 実測の不在」が残存リスクとして記載
- `dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md` — Obsidian 経路の修正。接続テストのガード非対称と実挙動未検証が残存リスクとして記載
