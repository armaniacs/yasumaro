# PBI: アーカイブ e2e の接続失敗・トークン不一致を解消し test ジョブを緑に戻す

## ステータス: 🔶 調査済み・未修正（2026-09-16 に原因2件を特定、いずれも未対処）

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

### 確定した問題1: offscreen 喪失がエラー分類から漏れている

`src/messaging/sqliteRpcClient.ts` の `categorizeError()` は offscreen 喪失を文字列 `offscreen` / `offscreenDocument` の有無で判定している。しかし Chrome が実際に返す文言は

```
Could not establish connection. Receiving end does not exist.
```

であり、どちらも含まない。結果、`offscreen_lost`（「Database connection lost. Please reload the extension.」という対処可能な案内）という専用の分類が存在するにもかかわらず `unknown` に落ち、生の文言がそのままユーザーに出る。

`src/messaging/__tests__/sqliteRpcClient-categorize.test.ts` で現状の挙動を固定済み。**修正時はこのテストの期待値を `offscreen_lost` に反転させること**（テスト内のコメントにも明記）。

なお、これはエラーの見せ方の問題であり、接続が切れること自体の原因ではない。

### 確定した問題2: confirm token が Service Worker 終了で揮発する

`src/background/confirmTokenManager.ts` はトークンを `chrome.storage.session` に 60 秒 TTL で保存する。このストレージは **MV3 の Service Worker 終了時に揮発する**。

MV3 の SW はアイドルで終了するため、トークン発行から検証までの間に SW が落ちると、TTL 内で未使用の正当なトークンでも `Confirmation token mismatch` になる。e2e は発行と検証の間に待機を挟むため、この窓に入りやすい。リトライすると成功するのは、再発行が正常に働くため（＝失敗が sticky でない）。これが「flaky に見える」理由と一致する。

`src/background/handlers/dashboardSqlite/__tests__/confirmTokenManager-sw-termination.test.ts` で実証済み。SW 終了は `chrome.storage.session.clear()` で再現している。

## 残る調査

- `Receiving end does not exist` が**なぜ起きるのか**そのものは未解明。拡張機能側は offscreen を明示的に閉じておらず（`closeDocument` の呼び出しは存在しない）、ブラウザの自動破棄と考えられる。メッセージのタイムアウトは 10 秒（`OffscreenTransportBase.ts`）に対し、G5 は記録完了を最大 15 秒待つ構造で、その間に破棄される余地がある
- 問題2 の対処方針の決定。トークンの保管先を SW 終了に耐えるストレージへ移すか、検証失敗時に再発行して1回だけ再試行する経路を設けるか。前者はセキュリティ設計（session-only にした意図）との整合を要確認
- 上記がユーザー環境でも実害を生むか（並行操作時にアーカイブ作成が失敗しうるか）の確認

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
