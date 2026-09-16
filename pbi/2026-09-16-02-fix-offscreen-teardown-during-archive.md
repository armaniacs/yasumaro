# PBI: アーカイブ作成中に offscreen が破棄されても処理を失わない

## ステータス: 未着手

## ユーザーストーリー

Yasumaro の利用者として、アーカイブ作成が「Database connection lost」で失敗しないでほしい。なぜなら記録が走っている最中にアーカイブを作ろうとすると、ブラウザ側の都合で処理が中断され、ユーザーには何が悪かったのか分からないまま失敗だけが残るから。

## 優先度

- 順位: PBI 2026-09-16-01 の後継（未着手）
- 根拠: CI の `test` ジョブに残る唯一の failed であり、回帰検知の最後の穴。ただしユーザー環境での実害が未確認のため、最優先ではない

## 背景

PBI 2026-09-16-01 で archive e2e の失敗を調査し、原因2件（confirm token の揮発 / offscreen 喪失の分類漏れ）を修正した。その結果 flaky 5件が解消し、残るのは 1 件だけになった。

```
G5: archive create runs while a recording is in flight — both succeed
→ Database connection lost. Retrying may recover it. (retriable: true)
```

分類の修正により、エラーは正しく `offscreen_lost` として返るようになった。しかし **`archive_create` はリトライしない**ため結果は変わっていない。

## なぜ単純なリトライで解決してはいけないか

`src/messaging/archiveWireTable.ts` で `archive_create` は **`noRetry: true`** と明示的に宣言されている。表のコメントは次のとおり。

> Ops that must never be blind-retried (timeout does not mean failure).

タイムアウトや接続断は「失敗した」ことを意味しない。offscreen 側で処理が**完走している可能性**がある。盲目的に再試行すると、アーカイブが二重に作られ、staging ファイルが孤児として残る。

したがって「e2e を緑にするために `noRetry` を外す」のは既存の設計判断を覆す誤った対処であり、本 PBI ではそれを採らない。

## 問題の構造

### なぜ接続が切れるのか

拡張機能側は offscreen を明示的に閉じていない（`closeDocument` の呼び出しはコードベースに存在しない）。ブラウザによる自動破棄と考えられる。

- メッセージのタイムアウトは 10 秒（`OffscreenTransportBase.ts` の `MESSAGE_TIMEOUT_MS_DESKTOP`）
- G5 は記録の完了を最大 15 秒待つ構造
- その待機中に offscreen が破棄される余地がある

### なぜ再開できないのか

staging 名は呼び出しごとに新規発行され（`archiveStaging.ts` の `prepareOutgoing()` → `issueName('outgoing')`）、その登録簿 `registry` は **offscreen のメモリ上にある**。offscreen が破棄されればレジストリごと消えるため、再接続しても「さっきの作成がどこまで進んだか」を知る手立てがない。

つまり **archive_create は中断からの再開を想定していない**。これが `noRetry: true` の実質的な理由でもある。

## 対処の方向性（いずれも設計判断を伴う）

### 案A: 冪等キーを導入し、安全に再試行可能にする

呼び出し側が生成した冪等キーを `archive_create` に渡し、offscreen 側は「このキーで既に作成済みか」を永続領域（OPFS 上のレジストリなど）で判定する。完走済みなら既存の staging 名を返し、未完了なら再開または作り直す。

- 利点: 根本解決。`noRetry` を安全に外せる
- 欠点: レジストリの永続化と、中断した staging の後始末（孤児ファイルの回収）が要る

### 案B: 操作中は offscreen の生存を保証する

`chrome.offscreen` に寿命を延ばす API は無いが、長時間操作の間だけ定期的にメッセージを送る（keepalive）ことで破棄を避ける運用は可能。

- 利点: 変更が小さい
- 欠点: 対症療法。keepalive が途切れれば同じ問題が再発する。MV3 の設計思想にも逆行する

### 案C: 長時間操作を分割し、各段階を冪等にする

`archive_create` を「staging 確保」「バッチ転送」「確定」に分け、各段階を短く冪等にする。中断しても続きから再開できる。

- 利点: 最も堅牢。大量レコードでも安定する
- 欠点: 変更が大きい。Phase A/B の既存構造との整合を要検討

## 先に確認すべきこと

**ユーザー環境で実害があるかは未確認。** 以下を確かめてから対処方針を決めるのが妥当。

1. 実機で「記録中にアーカイブ作成」を行い、失敗が再現するか
2. 再現する場合、レコード件数や待機時間との関係
3. G5 のテスト自体が現実的なシナリオか（15 秒待機が実装の想定内か、テスト側の前提が厳しすぎないか）

実害が無ければ優先度を下げ、テスト側の期待を実装に合わせる選択もありうる。ただし「テストが落ちているから期待を緩める」判断は、実害が無いことを確認してから行うこと。

## 受け入れ条件

```gherkin
Given 記録処理が実行中である
When アーカイブ作成を実行する
Then アーカイブ作成と記録の両方が成功する

Given アーカイブ作成中に offscreen document が破棄される
When 同じ操作が再度実行される
Then アーカイブは二重に作成されず、孤児の staging ファイルも残らない

Given CI の test ジョブ
When archive 系 e2e を実行する
Then G5 を含むすべての spec がリトライなしで通過する
```

## 備考

ローカル再現には `CI=1` が必要（spec が `CI` または `DISPLAY` の有無で skip 判定するため）。

関連: [[2026-09-16-01-fix-archive-e2e-flaky]]（本 PBI の前提となる調査と修正）
