# PBI: アーカイブ e2e の接続失敗・トークン不一致を解消し test ジョブを緑に戻す

## ステータス: ✅ 完了（2026-09-16）

原因3件をすべて解消し、archive 系 e2e は全件グリーンになった。confirm token の揮発とエラー分類の漏れは本 PBI で、残った G5 は [[2026-09-16-02-fix-offscreen-teardown-during-archive]] で対処した。

## ユーザーストーリー

メンテナとして、CI の `test` ジョブが緑であってほしい。なぜなら現在アーカイブ系 e2e が恒常的に失敗しており、新規の回帰が既存の赤に埋もれて検知できない状態だから。

## 優先度

- 順位: 次バージョンで実施（v6.9.2 のリリース判断時に別課題として切り出し）
- 根拠: プロダクトコードのユーザー影響は未確認だが、CI が赤いままだと以後のすべての変更で回帰検知が効かなくなる。検知能力の回復が主目的

## 背景

v6.9.2（PR #137）のリリース確認中に発見。`usability` ジョブの失敗（同意モーダルの競合）は同 PR で解消したが、`test` ジョブのアーカイブ系失敗は残った。

**この失敗は PR #137 の変更とは無関係**であることを検証済み。main を worktree に切り出してビルドし、同条件で `archive-recommended-verification.spec.ts` を実行したところ、変更なしの main でも同一の失敗（G5）が再現した。

| | G5 | flaky |
|---|---|---|
| main（変更なし） | failed | 2件 |
| PR #137 ブランチ | failed | 2件 |

## 失敗している spec

`testDir/e2e/archive-recommended-verification.spec.ts`

- `G5: archive create runs while a recording is in flight — both succeed`（恒常的に failed、リトライ2回とも失敗）
- `Y6: restore with deleted rows reports restoredDeleted`（flaky）
- `Y5': reloading the options page reconnects the open session`（flaky）
- `G3: archive_query treats % and _ as literals`（flaky）
- `Y4: restored records match title/url/is_starred at value level`（flaky）

`testDir/e2e/archive-required-verification.spec.ts` の R2（境界日付判定）、`testDir/e2e/dashboard-archive.spec.ts` も同ジョブ内で失敗が観測されている。

## エラー内容

```
archive_create failed: {"success":false,"error":"Unexpected error: Could not establish connection. Receiving end does not exist.","retriable":false}
import failed: {"success":false,"error":"Confirmation token mismatch"}
```

1つ目は offscreen document への接続失敗。`Receiving end does not exist` は offscreen がまだ生成されていない、あるいは既に破棄された状態で `chrome.runtime.sendMessage` が到達しなかったことを示す。G5 が「記録処理の実行中にアーカイブ作成を走らせる」並行シナリオである点と符合する。

2つ目は `confirmTokenManager` の確認トークン不一致。トークンの発行と消費の間で状態がリセットされている可能性。

## 調査済みの内容（2026-09-16）

### 否定された仮説: ChromeOffscreenTransport の並行処理バグ

`ensureOffscreenDocument()` の待機側（`creatingOffscreenPromise` を await する分岐）が、生成失敗を握りつぶして存在しない offscreen に送信してしまうのではないかと疑ったが、**バグは無かった**。rejection は待機側にも正しく伝播する。

このクラスにはテストが1件も無かったため、検証の副産物として `src/background/__tests__/ChromeOffscreenTransport.test.ts` を追加済み（生成の単一化・生成失敗時に送信しないこと・送信失敗後に1回リトライして復帰すること）。

### ✅ 対処済みの問題1: offscreen 喪失がエラー分類から漏れている

`src/messaging/sqliteRpcClient.ts` の `categorizeError()` は offscreen 喪失を文字列 `offscreen` / `offscreenDocument` の有無で判定している。しかし Chrome が実際に返す文言は

```
Could not establish connection. Receiving end does not exist.
```

であり、どちらも含まない。結果、`offscreen_lost`（「Database connection lost. Please reload the extension.」という対処可能な案内）という専用の分類が存在するにもかかわらず `unknown` に落ち、生の文言がそのままユーザーに出る。

**対処（2026-09-16）**: Chrome の文言 2 パターン（`Receiving end does not exist` / `Could not establish connection`）を `offscreen_lost` の判定に追加した。

あわせて `retriable` を `false` → `true` に変更した。旧コメントは「offscreen を失ったら再読み込みが必要」としていたが、`ChromeOffscreenTransport.invalidateContainer()` がキャッシュを破棄し**次回呼び出しで自動的に再生成する**現在の実装では、この前提は成り立たない。リトライには実際に回復の見込みがある。

二重実行の危険がないことは経路を追って確認済み:

- `categorizeError()` は `msgOffscreen` のリトライが**終わった後**に呼ばれるため、分類変更がトランスポート層のリトライ回数を変えることはない
- `retriable: true` が実際にリトライを起こすのは、呼び出し側が `retryAttempts` を明示した場合のみ（`callDashboard`）。指定しているのは `queryLogs` と `searchLogs` の**読み取り専用2つだけ**
- したがって破壊的操作が二重適用されることはない

ユーザー向け文言も「Please reload the extension.」から「Retrying may recover it.」に改めた。

`src/messaging/__tests__/sqliteRpcClient-categorize.test.ts` の期待値を反転済み。

### ✅ 対処済みの問題2: confirm token が Service Worker 終了で揮発する

`src/background/confirmTokenManager.ts` はトークンを `chrome.storage.session` に 60 秒 TTL で保存する。このストレージは **MV3 の Service Worker 終了時に揮発する**。

MV3 の SW はアイドルで終了するため、トークン発行から検証までの間に SW が落ちると、TTL 内で未使用の正当なトークンでも `Confirmation token mismatch` になる。e2e は発行と検証の間に待機を挟むため、この窓に入りやすい。リトライすると成功するのは、再発行が正常に働くため（＝失敗が sticky でない）。これが「flaky に見える」理由と一致する。

`src/background/handlers/dashboardSqlite/__tests__/confirmTokenManager-sw-termination.test.ts` で実証済み。SW 終了は `chrome.storage.session.clear()` で再現している。

**対処（2026-09-16）**: 送信側が mismatch を受け取ったとき、トークンを1回だけ再発行して再送する。

採用理由となったなぜなぜ分析の要点:

- トークン発行 `create_confirm_token` は `TOKEN_EXEMPT_OPS` にあり**誰でも呼べる**。したがって送信者検証を通過できる主体は元々いつでもトークンを取得でき、呼び出し元での再発行は攻撃者に新しい能力を与えない
- 一方 **SW 側での自動再発行は採用できない**。届いた引数がそのまま正当化され、scopeHash によるパラメータ束縛（「9月1日以前をアーカイブ」のトークンで「全期間」を実行させない仕組み）が無意味になる
- 再送が安全なのは、mismatch が**操作の実行前**に返る応答だから。データに触れていないので二重適用が起きない。他のエラーは実行済みの可能性があるため再送しない

実装は2箇所:

- `src/messaging/dashboardGateway.ts` — 実アプリの経路。`withConfirmToken()` を抽出し、mismatch のときだけ1回再発行して再送する
- `testDir/e2e/fixtures/dashboardSqliteHelpers.ts` — e2e はゲートウェイを経由せず自前でメッセージを組み立てるため（コメントに "Mirrors dashboardGateway.sendDashboard" と明記）、同じ回復処理を `dashboardMsg` に持たせた

エラー文字列は `CONFIRM_TOKEN_MISMATCH_ERROR`（`src/messaging/sqliteOperationSecurity.ts`）として送受信で共有し、リテラルの重複を排した。e2e ヘルパーは src/ から import できないため、そこだけ同期コメント付きで文字列を複製している。

**効果**: archive 系 e2e から `Confirmation token mismatch` が消滅。`archive-recommended-verification` の flaky 3件が解消し、`archive-required-verification` は5件すべて通過（CI で失敗していた R2 を含む）。

## 残る課題

### 未解決: G5 のみ（意図的にここで停止）

`G5: archive create runs while a recording is in flight` だけが依然 failed。分類の修正後、エラーは正しく `offscreen_lost` / `retriable: true` として返るようになったが、**`archive_create` はリトライしないため結果は変わらない**。

リトライさせなかったのは、`src/messaging/archiveWireTable.ts` で `archive_create` が **`noRetry: true`** と明示的に宣言されているため。表のコメントは「タイムアウトは失敗を意味しない」と述べており、実行済みか判別できない操作を盲目的に再試行しないという既存の設計判断である。e2e を緑にするためにこれを覆すのは本末転倒なので、ここで停止した。

**[[2026-09-16-02-fix-offscreen-teardown-during-archive]]** に分離し、そちらで解決済み。実測の結果 offscreen は破棄されておらず、生成直後でリスナーが未登録だっただけだった（この節が前提にしていた「破棄される」という見立ては誤り）。

### 未確認: ユーザー環境での実害

並行操作時にアーカイブ作成が失敗しうるかは未検証。トークン揮発のほうは実アプリの経路（dashboardGateway）も修正済みなので、ユーザーが遭遇していた可能性のある mismatch は解消している。

### 将来の検討課題: トークン機構そのものの再設計

今回の分析で、トークンは**偽造メッセージを止められていない**ことが分かった（発行が無防備なため、送信者検証を通過できる主体は自力でトークンを取得できる）。実質的な価値は scopeHash によるパラメータ束縛にある。

であれば「発行 → 検証」の2段階をやめ、送信時に payload から導出した署名を1回で送る設計に変えられる。SW 終了の影響を原理的に受けず、往復も1回減る。ただしセキュリティ設計の再レビューを伴うため、本 PBI の範囲外とする。

## 受け入れ条件

```gherkin
Given CI の test ジョブ
When archive 系 e2e を実行する
Then G5 を含むすべての spec がリトライなしで通過する

Given ローカルで CI=1 を付けて archive-recommended-verification.spec.ts を実行する
When --repeat-each=3 で反復する
Then 3回ともリトライなしで通過する

Given offscreen document が失われた状態
When categorizeError() が Chrome の切断文言を受け取る
Then kind は offscreen_lost となり、再読み込みを促す案内が返る

Given 有効かつ未使用の confirm token
When Service Worker が終了する
Then トークンは失われず、検証に成功する（または失敗しても呼び出し側が自動回復する）
```

## 備考

ローカル再現には `CI=1` が必要（spec が `CI` または `DISPLAY` の有無で skip 判定するため）。`CI=1` なしではテストが skip され、緑に見えてしまう。
