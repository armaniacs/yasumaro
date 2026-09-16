# PBI: アーカイブ e2e の接続失敗・トークン不一致を解消し test ジョブを緑に戻す

## ステータス: 未着手

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

## 調査の出発点

- `src/background/ChromeOffscreenTransport.ts` — offscreen のライフサイクル管理と、破棄後の再生成タイミング
- `src/background/OffscreenTransportBase.ts` — `invalidateContainer()` 後のリトライが `Receiving end does not exist` を回復できているか（`msgOffscreen` は1回だけリトライする）
- `src/background/confirmTokenManager.ts` — トークンの生存期間と、並行操作時の競合
- 並行実行そのものが成立しない仕様なのか、テストの前提が実装とずれているのかの切り分けを最初に行う

## 受け入れ条件

```gherkin
Given CI の test ジョブ
When archive 系 e2e を実行する
Then G5 を含むすべての spec がリトライなしで通過する

Given ローカルで CI=1 を付けて archive-recommended-verification.spec.ts を実行する
When --repeat-each=3 で反復する
Then 3回ともリトライなしで通過する
```

## 備考

ローカル再現には `CI=1` が必要（spec が `CI` または `DISPLAY` の有無で skip 判定するため）。`CI=1` なしではテストが skip され、緑に見えてしまう。
