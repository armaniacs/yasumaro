# PBI: Gist 同期の api.github.com を host_permissions と extension_pages connect-src の SSOT に宣言し、出荷済み Gist 機能の egress をブラウザ宣言と一致させる

## ユーザーストーリー

閲覧履歴を Obsidian と Gist の両方へ流しているユーザーとして、Gist の接続テストが「PAT が未設定」ではない実質的な応答まで到達してほしい、なぜなら Gist 機能はすでに出荷済みで UI も設定保存も動くのに、その唯一の外向き通信経路だけが manifest と CSP に宣言されていないため、ブラウザが fail-closed で自分の機能を禁じてしまうという不整合がユーザーから見えているからだ。

## 優先度

- 順位: 25 / 25
- RICE: 80（Reach=20 / Impact=0.25 / Confidence=100% / Effort=0.5）
- 根拠: 監査25位で、25候補中 RICE が最も低い。Gist 同期の 3 つの fetch は `https://api.github.com` を叩くが `skipCspValidation: true` を渡してランタイムの CSPValidator を飛ばし、かつその origin は `cspDomains.ts` のどの導出にも載っていないため manifest の host_permissions にも extension_pages の connect-src にも宣言されていない。監査ref のダッシュボード meta CSP は connect-src を https://tranco-list.eu だけに固定しており、これは二層目の阻止層。ソースから見える効果方向は fail-closed で、出荷済みの Gist 機能が自分自身の宣言を Browser が禁じているという逆算であり、攻撃者の利得は示されていない。唯一の production 構築点はダッシュボードの接続テストで、sync() / syncBatch() には production 呼び出し元が無い。順位を最下位とするのは「対外 egress の安全側の不整合」であり「境界突破」ではないためであり、着手優先度は低い。ただし出荷済み機能が動作しないという事実自体はユーザーに見える不具合であり、影響的には軽微だが修正には意味がある。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴あり（host_permissions と CSP に origin を追加するため、拡張機能の宣言範囲が広がる。api.github.com は manifest の常時許可ホストと connect-src の許可オリジンになり、ブラウザ側から見れば「この拡張は GitHub API へ接続できる」ことが宣言される。宣言を optional_host_permissions に逃がしてユーザー同意に委ねる選択肢もあるが、Gist は PAT を持つ自己完結型の egress であり chrome.permissions.request の UI 面における遅れを新たに背負うことになる。実害は「宣言範囲の拡大」に留まり、権限そのものは GitHub API の GET / POST / PATCH のみであり、任意サイトへの読み書きではない）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `gistSyncTarget.GIST_API_BASE::cspDomains.CSP_DOMAINS`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 11番）。

claimed root cause: `src/utils/cspDomains.ts` は manifest host_permissions と extension_pages CSP connect-src の両方を導出する単一情報源（SSOT）だが、Gist の egress 経路に対して一度も拡張されていない（provider row・list source・loopback port のいずれにも api.github.com は対応しない）。そのうえで fetch 側は、宣言されていない origin に対する CSPValidator の fail-closed ブロックを `skipCspValidation: true` で回避しており、結果として同じ拡張内の他のすべての fetch 経路よりゲートが弱く、manifest は出荷済み機能を過少宣言したまま残っている。

### Trace（実ファイルで確認した行番号）

- [entrypoint] `src/background/syncTargets/gistSyncTarget.ts:21` ― `const GIST_API_BASE = 'https://api.github.com'`。これが testConnection（`:134` の GET /user、PAT を `Authorization: token <pat>` で送出）、createGist（`:162` の POST /gists）、updateGist（`:191` の PATCH /gists/{gistId}）の3本の呼び出し元になっている
- [propagation] `src/background/syncTargets/gistSyncTarget.ts:141`（3本すべて: `:141` / `:164` / `:193`）― 3つの fetch すべてが `skipCspValidation: true` を渡し、`allowedUrls` も渡さないため、runtime の origin allowlist は1件も評価されない
- [propagation] `src/utils/fetch.ts:118` ― `if (!skipCspValidation)` が CSPValidator チェック（`:128` の `CSPValidator.isUrlAllowed`）を丸ごとスキップさせる。残るコード側の制御は validateUrl（`:112`）のスキーム／プライベートIPガードのみ
- [sink] `src/utils/cspDomains.ts:75` ― `buildConnectSrcDomains()` は `AI_PROVIDER_HOST_PERMISSIONS`（`:26`）と `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`（`:31`、`:35` で `ALL_LIST_SOURCES` から導出）を末尾の `/*` を剥がして連結するだけの純関数であり、api.github.com はどちらにも含まれない

### 証拠

- `src/utils/cspDomains.ts:26-28` ― `AI_PROVIDER_HOST_PERMISSIONS` は `deriveRequiredDomains()` から `https://${domain}/*` を生成するだけ。GitHub API ホストに対応する row は存在しない
- `src/utils/listSources.ts:42-45` ― `ALL_LIST_SOURCES` は `FILTER_LIST_SOURCES`（`:23-29` の raw.githubusercontent.com / gitlab.com / easylist.to / pgl.yoyo.org / nsfw.oisd.nl）と `TRANCO_METADATA_SOURCE`（`:37-40` の tranco-list.eu）の合成であり、api.github.com は無い
- `src/utils/fetch.ts:118` ― 3つの Gist fetch は runtime origin allowlist を持たず、コード駆動の制御は validateUrl のみ
- `src/dashboard/gistSettings.ts:44-48` ― `createSharedGistConnectionTester`（gistSyncTarget.js と offscreenGateway.js を動的 import し、`new GistSyncTarget(getSharedSqliteClient())` を返す）が GistSyncTarget の唯一の production 構築点。したがって実際の通信はダッシュボードのページコンテキストから PAT を送出する GET /user のみで、sync() / syncBatch() には production 呼び出し元が無い
- `wxt.config.ts:270` ― extension_pages の CSP connect-src は `buildLocalConnectSrc()` + `buildConnectSrcDomains()` のみから合成され、api.github.com はブラウザが強制するポリシーに届かない
- `entrypoints/options/index.html:7-8` ― 監査ref でのダッシュボード手書き meta CSP は connect-src を https://tranco-list.eu だけに固定しており、ダッシュボードコンテキストの Gist fetch に対する二層目の阻止層になっている

### 補足（SSOT ではない並列 derivation がある点）

`cspDomains.ts` を直しても runtime gate とは自動的に揃わない。`src/utils/cspValidator.ts` は別に `DEFAULT_ALLOWED_DOMAINS`（`:47` の `deriveRequiredDomains()` 由来）と `OPTIONAL_DOMAINS`（`:80-83`。`ALL_LIST_SOURCES` から raw.githubusercontent.com と gitlab.com だけに絞って抽出）を持っており、`initializeFromSettings`（`:135-199`）も保存設定由来の provider domain と Obsidian origin を別系統で加える。**manifest と CSP 文字列の供給元は cspDomains.ts、runtime gate の供給元は cspValidator.ts** という二系統構成である点が、最小変更の選択肢 3（skipCspValidation を外すか）の判断材料になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 1: すべての Gist fetch 先が単一の宣言箇所から導出されている
  Given 出荷済みの Gist 同期機能が api.github.com を唯一の宛先 origin として持つ
  When  manifest の host_permissions と extension_pages CSP の connect-src を生成する
  Then SSOT（cspDomains.ts の導出）から api.github.com を含むエントリが得られること
  And  この1箇所の変更だけで host_permissions と connect-src の両方が同時に更新されること
        （CSP 文字列へ手で追記する二箇所編集が不要であること）
  And  どちらかが更新され、もう一方が取り残されるドリフト状態にならないこと

Scenario: 2: ダッシュボードの Gist 接続テストが宣言済み origin へ到達できる
  Given ユーザーがダッシュボードの Gist 設定に所有する PAT を保存済みである
  When  ダッシュボードの「接続テスト」ボタンを押す（testConnection が GET /user を発行する）
  Then リクエストは宣言済み origin である api.github.com へ到達し、
        PAT を添えて送る経路がブラウザに遮られないこと
  And  ブラウザ console に api.github.com を名指しする connect-src 違反が出ないこと
  And  拡張自身の meta CSP（ダッシュボード）による二重の遮断も起きないこと

Scenario: 3: 宣言していない origin へのリクエストはブラウザに遮られる（回帰ガード）
  Given SSOT には宣言されていない未知の origin（例: https://evil.example）がある
  When  その origin へ接続を試みる
  Then ブラウザに強制される connect-src と host_permissions によって遮られること
  And  SSOT 側で宣言した origin だけが通る状態を維持すること
        （「全部通す」変更に退化していないことを固定する）

Scenario: 4: PAT を添えた egress 経路が従来どおり実ゲートを通る（宣言と実ゲートの乖離がない）
  Given 実装判断として api.github.com を runtime gate 側にも宣言した
  When  Gist の3つの fetch（GET /user、POST /gists、PATCH /gists/{id}）を実行する
  Then runtime の CSPValidator がこれら3本を「宣言済み」として通し、gate で捨てられないこと
  And  gate を通さない抜け道（無条件スキップ）が残っていないこと
  And  PAT がリクエストログやエラーメッセージへ漏れないこと
        （既存の describeHttpFailure と i18n の経路を維持する）
```

## 受け入れ基準

- [ ] api.github.com が SSOT（`src/utils/cspDomains.ts` の導出）に1箇所で追加され、同じ変更で manifest host_permissions と extension_pages CSP connect-src の両方が更新されること（CSP 文字列への手動追記を禁止）
- [ ] `entrypoints/options/index.html` の meta CSP が、宣言した egress 先と矛盾しないこと（connect-src が https://tranco-list.eu だけの固定のまま 2枚目の阻止層として残らないか、確認結果をコードコメントまたは ADR に記録する）
- [ ] api.github.com を宣言する置き場所について意味的に正しい方を明示して選び、理由をコメントで残すこと（`ALL_LIST_SOURCES` に置くか、AI プロバイダ行に置くか、別の egress 専用 SSOT を新設するか。Gist は filter list でも AI プロバイダでもない点が判断材料）
- [ ] skipCspValidation の扱いを明示的に決めること（宣言後は外すのが SSOT の目的。外す場合は runtime gate 側にも api.github.com を宣言し、既存の fail-closed ブロックが解消していることをテストで示す。外さない判断をする場合は「宣言」と「実ゲート」の乖離が残ることをコメントで明示する）
- [ ] `buildConnectSrcDomains()` の出力に api.github.com が含まれることを pin する単体テストが追加され、既存の「宣言されていない origin は CSPValidator で拒否される」pin（`src/utils/__tests__/cspValidator.test.ts` の該当アサーション）が引き続き緑であること
- [ ] `wxt.config.ts` の host_permissions と extension_pages connect-src へ反映されることを検証するテストが存在すること（`src/__tests__/wxt-build.test.ts` は `describe.skipIf(!distExists)` で dist 必須かつ現状 CSP を検査していないため、SSOT 単位の検証を主体とし、dist 検証は補助的位置づけとする）
- [ ] 既存の Gist テスト（`src/background/__tests__/gistSyncTarget*.ts`、`src/dashboard/__tests__/gistSettings*.ts`）が全て緑で、`npm run validate`（type-check と test）が緑であること
- [ ] `PERMISSIONS.md` の host_permissions 説明と「データ送信先は 2 種類のみ」という審査担当者向け注記、および `SECURITY.md` の egress 方針が Gist を含んだ実態に更新されていること（現状、両ドキュメントに Gist の記載は1件も存在しない）

## テスト戦略

- 単体: `buildConnectSrcDomains()` の出力に api.github.com が含まれることを pin し、`AI_PROVIDER_HOST_PERMISSIONS` / `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS` への包含も同時に確認する（SSOT への追加が manifest と CSP の両方に反映されることの保証）。加えて、宣言されていない origin が `CSPValidator.isUrlAllowed` で拒否されること（既存の `src/utils/__tests__/cspValidator.test.ts` の fail-closed pin）を維持し、宣言を増やすほど全部通す劣化を回帰で防ぐ。skipCspValidation を外す判断をした場合は、gistSyncTarget の3本の fetch が `global.fetch` に渡した init を直接 assert して無条件スキップが残っていないことを検証する（実ブラウザの挙動に依存させない）
- 統合: wxt.config.ts を読む側からの検証。`buildConnectSrcDomains()` と `AI_PROVIDER_HOST_PERMISSIONS` を wxt.config.ts と同じ入力で評価し、host_permissions と extension_pages connect-src への反映を検証する（`src/__tests__/wxt-build.test.ts` の dist 検査に CSP アサーションを追加するか、SSOT 単位の conformance テストを `src/utils/__tests__/` に置くか。既存に同種の検証として `src/utils/__tests__/list-sources-conformance.test.ts` の cross-table conformance パターンがあるので、それに倣う）。同じテスト内で `entrypoints/options/index.html` の meta CSP も読み取って宣言した egress 先と矛盾しないことをまとめて検証すると、層が1つ減る
- E2E: owner 観測。unpacked ビルドを隔離プロファイルで読み込み、`dist/chromium-mv3/options.html`（ダッシュボード）を開き、Gist 設定に所有する PAT を入れて「接続テスト」をクリックし、(a) ダッシュボードおよび service worker の console に api.github.com を名指しする connect-src 違反が出ないこと、(b) PAT の正当性とは独立して、実サーバーからの応答（200 でも 401 でもよい。PAT 未設定の早期 return ではないこと）に到達していること、を確認する。追加で `browsing_logs` の gist_synced が 0 から変わるかは任意確認（sync() / syncBatch() の production 呼び出し元が無いため）

## 実装メモ（実装者向け）

### フェーズ0: 既実装確認の結果

- `grep -rn "api.github.com" src/ entrypoints/ wxt.config.ts` → ヒットは `src/background/syncTargets/gistSyncTarget.ts:21`（定数）と既存テストの URL アサーションのみ。**SSOT への宣言追加は未実装**
- `grep -rn "GistSyncTarget" src/ entrypoints/` → 唯一の production 構築点は `src/dashboard/gistSettings.ts:48`。他は全てテスト。sync() / syncBatch() に production 呼び出し元は無い
- `grep -rn "buildConnectSrcDomains" wxt.config.ts` → `:7`（import）と `:24`（`aiConnectSrc`）。SSOT への追加1箇所で両方に波及する構造は既に存在する
- 結論: **未実装**。ただし「Gist 機能そのもの」は出荷済みであり、本 PBI は新機能の追加ではなく「出荷済み機能の宣言の追従」

### 対象ファイルと該当行

| ファイル | 行 | 現状 |
|---|---|---|
| `src/background/syncTargets/gistSyncTarget.ts` | 21 | `const GIST_API_BASE = 'https://api.github.com'` ― SSOT 外のハードコード定数 |
| `src/background/syncTargets/gistSyncTarget.ts` | 134 / 141 | testConnection の GET /user。skipCspValidation は true |
| `src/background/syncTargets/gistSyncTarget.ts` | 162 / 164 | createGist の POST /gists（閲覧履歴 markdown を body に含む）。skipCspValidation は true |
| `src/background/syncTargets/gistSyncTarget.ts` | 191 / 193 | updateGist の PATCH /gists/{gistId}。skipCspValidation は true |
| `src/utils/fetch.ts` | 107 / 118 / 128 | skipCspValidation の既定 false、`if (!skipCspValidation)` のゲート、`CSPValidator.isUrlAllowed` 判定。`:112` が validateUrl、`:140-143` が allowedUrls |
| `src/utils/cspDomains.ts` | 26-28 | `AI_PROVIDER_HOST_PERMISSIONS`（deriveRequiredDomains 由来）― GitHub API host なし |
| `src/utils/cspDomains.ts` | 31-36 | `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`（`:35` で ALL_LIST_SOURCES を導出）― 延伸の余地あり |
| `src/utils/cspDomains.ts` | 75-79 | `buildConnectSrcDomains()` ― CSP connect-src の唯一の供給元 |
| `src/utils/cspDomains.ts` | 85-100 | `validateCspDomains()` ― wxt.config.ts:25 から呼ばれ、空白・引用符・セミコロン・非 URL を拒否 |
| `src/utils/listSources.ts` | 23-29 / 37-40 / 42-45 | `FILTER_LIST_SOURCES` / `TRANCO_METADATA_SOURCE` / `ALL_LIST_SOURCES`。api.github.com は無い |
| `src/utils/cspValidator.ts` | 47 / 80-83 / 100-101 / 135-199 | runtime gate 側の別系統 derivation。既定許可は required providers、任意許可は ALL_LIST_SOURCES の2ホストのみ |
| `src/dashboard/gistSettings.ts` | 43-49 / 92-100 | 唯一の production 構築点と、接続テストボタンの click ハンドラ |
| `wxt.config.ts` | 4-11 / 23-25 / 245 / 246 / 270 | SSOT の import、aiConnectSrc の生成と検証、optional_host_permissions、host_permissions、extension_pages CSP |
| `entrypoints/options/index.html` | 7-8 | ダッシュボードの手書き meta CSP。connect-src は https://tranco-list.eu のみ |

### 既存テスト

| テスト | 役割 |
|---|---|
| `src/utils/__tests__/cspDomains.test.ts:21-50` | `buildConnectSrcDomains()` の末尾 `/*` 除去・required と optional の包含・順序の pin。SSOT 追加の検証点 |
| `src/utils/__tests__/cspDomains.test.ts:82` | `validateCspDomains()` が local と AI ドメインで throw しない pin |
| `src/utils/__tests__/list-sources-conformance.test.ts:71-82` | `ALL_LIST_SOURCES` の全ホストが `CSPValidator.isUrlAllowed` を通る SSOT drift pin。Gist を list source として扱えば同型の検証が得られる |
| `src/utils/__tests__/cspValidator.test.ts:74-88` | 未宣言ドメインが fail-closed で拒否される pin。回帰ガードとして維持 |
| `src/__tests__/wxt-build.test.ts:30` | `describe.skipIf(!distExists)` の dist 構造検証。**現状 manifest の CSP と host_permissions を検査していない** |
| `src/background/__tests__/gistSyncTarget-r2.test.ts:264, 313` | api.github.com/user と api.github.com/gists/existing-123 の URL アサーション |
| `src/dashboard/__tests__/gistSettings.test.ts:44` | GistSyncTarget を `vi.fn` で差し替えるモック |

### 最小変更の選択肢

1. **cspDomains.ts の導出に api.github.com を追加する（SSOT 一箇所で manifest と CSP の両方が更新される）** ― **推奨**。`wxt.config.ts:246` の host_permissions と `:270` の connect-src が同時に更新され、放置すると確実に再発する「片方だけ更新」型のドリフトを防ぐ。実装上は `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`（`:31-36`）に1行足す形が最も小さいが、意味的には Gist は filter list でも AI プロバイダでもないため、**「Gist は同期ターゲットが使う egress 先であり、filter list でも AI provider でもない」**というコメントを必ず残すこと
2. **既存のリストソース（listSources.ts の ALL_LIST_SOURCES）か、AI プロバイダ行（`src/utils/storage/providerAllowlist.ts:69` の PROVIDER_ALLOWLIST_ROWS）のどちらかに Gist を置くかを決める** ― **推奨は「どちらも置かない」**。ALL_LIST_SOURCES は FILTER_LIST_SOURCES と Tranco metadata を含み、urlWhitelist のゲート・buildAllowedUrls・OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS・CSPValidator へ横断して波及する（list-sources-conformance.test.ts の cross-table pin がその波及を固定している）。ここに Gist を足すと、ユーザーは「uBlock のフィルタリスト」として GitHub API を登録できてしまうという意味の誤った性質になり、攻撃面ではないという前提の urlWhitelist ゲートに API origin が入る。PROVIDER_ALLOWLIST_ROWS は AI プロバイダの UI 一覧（id / label / domain / permissionTier / conditionalCsp）駆動であり、Gist の行は要約機能の選択肢として表示され得る。**Gist がどちらにも属さない egress であることを明示したうえで、cspDomains.ts 内に「同期ターゲット由来の egress」導出を新設するか、syncTargets 側の定数表を SSOT にして cspDomains がそれを参照する形にする**のが意味的に正しい。どちらが正しいかを実装時に WHY 付きのコメントとして固定すること
3. **skipCspValidation をそのまま残すか、宣言後は外すかを決める** ― **推奨は外す**。SSOT 主義の目的は「宣言と実ゲートを一致させる」ことであり、宣言したのに runtime gate は通らないまま無条件スキップで迂回していると、宣言と実ゲートの乖離が残ったままになる。ただし cspDomains.ts を直しても cspValidator.ts 側は自動更新されない（DEFAULT_ALLOWED_DOMAINS は deriveRequiredDomains 由来、任意許可は ALL_LIST_SOURCES の2ホストのみ）ため、外す場合は runtime gate 側にも api.github.com を宣言する必要がある。**この2系統を同時に入れないと「SSOT では宣言した、しかし gate は別表でブロックする、結局スキップを外せない」という完全な行き止まりが発生する。** 逆に外さない判断をする場合は、その乖離をコードコメントで明示し、受け入れ基準の注記として残す

### 評価の明示（なぜ最下位か）

本件は「fail-closed であり、攻撃者の利得が無い」という一方向の不整合である。ソースから読み取れる効果方向は一貫して防御側で、攻撃側に有利ではない。

- origin が宣言されていないことで、ブラウザが Gist の egress を **遮断する**（防御が働く側）
- skipCspValidation は runtime gate を弱めるが、その gate が守っていたのは「宣言済み origin への送信」であり、宣言されていない origin を gate が通過させたところで **新たな到達点が増えるわけではない**
- 唯一の production 通信はダッシュボードからの GET /user（read-only）であり、POST /gists と PATCH /gists/{id} は production 呼び出し元を持たない
- したがって「境界突破」ではなく「**出荷済み機能が、自分自身の宣言をブラウザに禁じられている**」という **安全側の不整合**であり、着手優先度は 25 候補中最も低い。ただし「出荷済み機能が動作しない」のはユーザーから見える事実（接続テストが常に失敗する、gist_synced が 0 のまま）であり、影響的には軽微だが、修正には意味がある

### ブロッカー（着手前に潰すべき owner 確認）

1. **Chrome MV3 が extension_pages connect-src とダッシュボードの meta CSP を適用して api.github.com/user を拒否するのか** ― これはブラウザ政策の挙動で、ソースからは観測不能。needs_validation の留保理由そのもの。実ビルドとブラウザでの観測なしに「直した」としないこと
2. **sync() / syncBatch() の production 呼び出し元が無いのは意図か、それとも配線漏れか** ― 呼び出し元が無いなら、本 PBI の実害はダッシュボードの接続テストのみ。ただし「配線漏れ」なら本 PBI の範囲が「宣言の追従」から「未接続機能の配線」まで広がるため、着手前に owner が確定させること
3. **ダッシュボードの meta CSP は意図的に tranco-list.eu だけなのか** ― 意図的である場合、本 PBI の実装はそのコメントの趣旨と衝突する。意図的であれば meta CSP にも api.github.com を足すか、あるいは meta CSP を wxt.config.ts の SSOT から生成するか（ダッシュボードはすべての egress を extension_pages CSP に委ねる方針が本来はクリーン）この判断を owner に求める
4. **宣言先を host_permissions（常時許可）にするか optional_host_permissions（ユーザー同意）にするか** ― optional にすると Gist 機能の利用前に同意 UI が発生し、ダッシュボードの UX が変わる。常時許可のままでよいか（Gist は PAT を送る egress で、ブラウザ警告の影響は限定的）を owner が判断すること

いずれも owner 確認として PBI の冒頭に置き、実装着手の前に対応する。

### ロールバック手順

1. 変更は `src/utils/cspDomains.ts`（SSOT への1行追加）と、選択肢3を採用した場合は `src/utils/cspValidator.ts` と `src/background/syncTargets/gistSyncTarget.ts` の3箇所の skipCspValidation 削除に限定する。ストレージキー・データ形式・UI の変更を含まないためデータ移行は不要
2. ロールバックは上記 hunk を戻すだけで足りる（manifest はビルド生成物のため、再ビルドすれば元に戻る）
3. 宣言後にビルドした拡張が「Gist に接続できない」という報告を受けた場合は、まず追加した origin へのリクエストがブラウザに到達しているか（console の CSP 違反）を確認し、遮られているなら meta CSP（`entrypoints/options/index.html:7-8`）か `wxt.config.ts:270` の合成漏れを追う。選択肢3を採用した場合は CSPValidator 側の宣言漏れが第一候補
4. 回帰が疑われる場合は、単体の pin（`buildConnectSrcDomains()` の出力）と既存の fail-closed pin（`cspValidator.test.ts` の未宣言ドメイン拒否）をまとめて単発実行して確認する

### ドキュメントの現状（本 PBI で更新が必要）

- `PERMISSIONS.md:151` ― all_urls についての行のみ。Gist の記載は**1件も無い**
- `PERMISSIONS.md` の Reviewer Notes 2 ― 「データ送信先は 2 種類のみ（AI プロバイダーと Obsidian Local REST API）」と書かれているが、Gist は第三の送信先であり、宣言を行った後は記述と実態が食い違う。更新が必要
- `SECURITY.md` ― Scope 節（`:23-32`）に CSP は含まれるが、egress 方針の節は存在しない。Gist を含む送信先の記述を追加するか、`dev-docs/SECURITY_REVIEW_GUIDE.md` 側へ寄せるかを決めること
- `public/PRIVACY.md` と `docs/PRIVACY.md` ― 同一内容を保つ規程があるため、Gist を送信先として列挙するなら両方を同時に更新すること

## 見積もり

1.0 SP（人週 0.5 日）。ブロッカー4件の owner 確認（0.5-1 時間）、SSOT への追加と置き場所の決定（1-2 時間）、単体と統合テストの追加（2-3 時間）、`npm run validate` とレビュー（1-2 時間）。選択肢3（skipCspValidation の外し）を採用する場合は cspValidator.ts 側の宣言追加と既存 Gist テストの初期化アサーション更新が加わり、+1-2 時間。E2E は owner 観測であり工数には含めない。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint を完了記録に残す（`gistSyncTarget.GIST_API_BASE::cspDomains.CSP_DOMAINS`）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`PERMISSIONS.md` の host_permissions 説明と Reviewer Notes の送信先一覧、`SECURITY.md` の egress 方針。public/PRIVACY.md を触る場合は docs/PRIVACY.md も同時）

## 調査結果（2026-10-18）

- 判定: **REMAINS**（構造確定、ブラウザ実機は owner）
- 決め手: `cspDomains.ts` の導出にも `listSources.ts` の `ALL_LIST_SOURCES` にも `api.github.com` が無く、`gistSyncTarget.ts` の 3 fetch は `skipCspValidation: true` でランタイムゲートを迂回する構造を確認。**さらに `cspValidator.ts:47/80-83` は `cspDomains.ts` とは別の並列 derivation** であり、SSOT を直してもランタイムゲートは自動更新されない（選択肢 3 とセットで実装しないと行き止まり）
- 影響: 実装メモに「2 つの derivation を同時に直す」制約を追記。MV3 が extension_pages connect-src とダッシュボード meta CSP を実際に適用するかの実機確認は owner

## 関連

- `pbi/00-INDEX.md`
- PBI 08（Obsidian 経路の redirect ガード）― **別の論点**。PBI 08 は「宣言済みの origin が 30x でどこへ行くか（redirect の hop 毎再検証）」の話であり、本 PBI は「api.github.com という origin そのものを宣言する層（host_permissions と connect-src）」の話である。両者は同じ egress を対象とするが、修正点が別（redirect オプションか CSP 宣言か）であり、実装を同時に行っても単一の根本原因には収まらない。両方を触る場合は `src/utils/fetch.ts` を共有するため hunk 分割すること
- `src/utils/listSources.ts` ― SSOT 追加の置き場所候補（選択肢2 参照）
- `src/utils/cspValidator.ts` ― runtime gate 側の別系統 derivation（選択肢3 参照）
- `dev-docs/SECURITY_REVIEW_GUIDE.md` ― CSP と egress の脅威モデル
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（findings.json と NEEDS-VALIDATION.md 11番）

## 実装記録（2026-10-21・owner 判断込みで完了）

- **実装済み** PBI 2026-10-21-11（commit `e179bc8a`）。宣言フェーズ → skip 削除フェーズの 2 系統同時修正制約（調査結果の記載どおり）を厳守して実装
- 宣言先の置き場所（選択肢 2）: **egress 専用定数を新設**（GIST_EGRESS_HOSTS / GIST_EGRESS_HOST_PERMISSIONS。ALL_LIST_SOURCES にも PROVIDER_ALLOWLIST_ROWS にも置かない。「Gist は同期ターゲットが使う egress であり filter list でも AI provider でもない」を PBI 記載の判断材料として採用）
- ブロッカー 4（host_permissions vs optional）: **host_permissions に常時宣言**（https://api.github.com/*。optional への逃がしは同意 UI 配線が新規に要るため不採用）
- 選択肢 3（skipCspValidation）: **外す**。cspValidator に egress 用 static set + isUrlAllowed 1 チェック行を追加したうえで、gistSyncTarget の 3 箇所（testConnection / createGist / updateGist）の skipCspValidation を削除（fetchWithRedirectGuard は意図的 skip のためオプション自体は維持）
- ブロッカー 3（meta CSP の tranco 固定）: **connect-src 指示子を削除し extension_pages CSP に一任**（tranco は SSOT 経由で connect-src に載るため二重管理を解消）
- ブロッカー 2（sync / syncBatch の未配線）: **意図的未配線と裁定**（production 呼び出し元 0 件・testConnection のみ使用）。宣言追従に限定し、配線は別 PBI 候補として記録
- テスト: cspDomains / cspValidator に宣言 pin・ゲート pin・派生整合 pin、manifest.test.ts に host_permissions SSOT 合成 pin（31/40）、gistSyncTarget に「skip が渡らない」BDD pin。csp/gistSyncTarget 系 12 ファイル 168 テスト green
- ドキュメント更新（受け入れ基準の最終行）: PERMISSIONS.md に Gist egress の節（13. host_permissions）を新設し Reviewer Notes のデータ送信先を 3 種類に更新、SECURITY.md の Scope に egress destinations を追記（2026-10-21）
- 残置（owner 手動確認）: ブロッカー 1 ― MV3 が extension_pages CSP と meta CSP を api.github.com に適用するかの実機確認（E2E 相当）

## 追記（2026-10-21・統合側検証で発見・修正）

- 実装（PBI 2026-10-21-11）の初回では api.github.com が host_permissions のみに反映され、extension_pages CSP connect-src に漏れていた（BDD シナリオ 1 の SSOT 一括更新を満たさない・options ページからの fetch が CSP で遮られる）。commit `857be356` で buildConnectSrcDomains() に GIST_EGRESS_HOST_PERMISSIONS を追加し、SSOT 1 箇所の変更で host_permissions と connect-src の両方が更新される契約を pin で固定。make build で manifest connect-src に api.github.com が反映されることを確認済み