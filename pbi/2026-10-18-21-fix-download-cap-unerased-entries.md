# PBI: ダウンロード追跡リストの 200 件上限で落ちたレコードが erase 経路から消え、30 日の保持期間を越えたエントリが chrome://downloads に残る問題の修正

## ユーザーストーリー

ローカル Markdown 自動エクスポートを常用し、ブラウザのダウンロード履歴を自分自身の記録の置き場所として信用しているユーザーとして、**エクスポートのダウンロードエントリが、このモジュールが守る 30 日という保持期間を越えてダウンロード履歴に残るまま放置されないこと**がほしい、なぜなら `localMarkdownExportRetention.ts` の存在意義は「30 日を超えたエクスポート痕跡を消す」ことなのに、`recordDownloadId` の 200 件上限が **追跡リストから落とすだけでダウンロードエントリを消さない**ため、リストから消えたエントリは以後 **どの削除経路からも見えなくなり**、ユーザーが明示的に消さない限り `chrome://downloads` に残り続けて、自分の閲覧記録の保存期間が事実上無期限になるから。加えて 200 件上限のヘッダ注释は「30 日分の日次 flush ＋ immediate/idle タイミングの余裕を見込んだ **使用量の見積もり**であり、強制された上限ではない」と書きながら、コードは強制された上限として機能している、この**仕様と実装の乖離**自体が明示されていない。

## 優先度

- 順位: 21 / 25
- RICE: 333（Reach=100 / Impact=0.25 / Confidence=100% / Effort=0.3）
- 根拠: 監査21位。追跡リストが 200 を超えると `recordDownloadId` が最古レコードをスライスで落とすだけで、そのエントリの `chrome.downloads` は削除しない。src 内で erase/removeFile を呼ぶのは `purgeExpiredDownloadRecords` だけで、その claim は「現時点でリストに残っているレコード」からのみ計算されるため、cap で落ちたレコードはどの削除経路からも見えない。`chrome.downloads.search` による sweep も src に存在しない。よってエントリは 30 日 cutoff を超える `chrome://downloads` に残り続ける。到達性は「即時 flush が1分に1回まで許可」「idle flush が idle ごとに走る」ことで、1日あたりの cap が無く 30日内に 200 を超える蓋然性が高い。ディスク側は日付ごとの overwrite で有界なので、リークするのはダウンロード履歴エントリとファイル参照のみ。駆動主体はユーザー自身の閲覧（低信頼エントリポイントなし）で、影響は自分自身のダウンロード履歴に閉じる。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中（削除経路の設計変更）
- 副作用: 🔴あり（**削除ポリシーが変わり、ユーザー可視のダウンロード履歴の消し方に影響する**。理由: 選択肢 1 の「削除待ちキュー」は新たな永続キー（service worker 再起動を跨いで復元されなければならない）を追加し、`:104-113` のコメントが明示している「claim してから erase する」設計は「クラッシュすると `chrome://downloads` にエントリが残る forever」という**回復可能方向のトレード**を前提に成り立っているため、キュー追加はこの前提を再検証しないと「改善」が「別種のリーク（キュー自体の取りこぼし）」に化ける。選択肢 3 の `chrome.downloads.search` sweep は `chrome.downloads` が**ブラウザ全体のダウンロードを追う**API であるため、照合キーの取り違えはユーザー自身の無関係なダウンロードを消す事故に直結し、これは PBI 22（`export-purge-erase:stale-session-download-id-dereference`、id 再利用で無関係な新規ダウンロードを消す）が既に摘出しているのと同種のリスクである。加えて既存テスト `localExportRetention.test.ts:117-131` が**現状の落とし動作を pin している**ため、期待値の書き換えが不可避）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `export-download-cap:oldest-drop-leaks-unerased-entries`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` の needs_validation エントリ / `NEEDS-VALIDATION.md:189-219` の「## 7. MAX_DOWNLOAD_RECORDS oldest-drop removes records from tracking without erasing their download entries — no cleanup path remains」）。verdict は `needs_validation`、判定は環境観測 2 点を blocker として挙げている。

**再現経路（trace / 実ファイルで再確認した行）**

1. `src/background/localMarkdownExportCore.ts:62-69` — `flushBufferedExports` が日次バッファ1日分ごとに `chrome.downloads.download` を1回呼ぶ。`:68` の `conflictAction: 'overwrite'` により**ディスク上のファイルは日付ごとに上書きされ有界**。`:71-73` で downloadId が数値なら `:72` の `recordDownloadId(downloadId, date)` が1件記録される。
2. `src/background/localMarkdownIdleFlusher.ts:114-118` — `scheduleImmediateFlush` は `IMMEDIATE_DEBOUNCE_MIN = 1`（`:21`）のワンショットアラームで、**記録ごとに最大1回/分**の flush まで許可する。`:58-60` の `onIdleStateChanged` は idle イベントごとに `flushBufferedExports` を呼び、`:76` の `IDLE_FALLBACK_ALARM`（`periodInMinutes: 30`）が補助する。`daily` タイミングも `:81-84` で 1440 分周期。**どのタイミングにも 1日あたりの flush 数の上限はソース上に存在しない**。
3. `src/background/localMarkdownExportRetention.ts:79-80` — `appended.length > MAX_DOWNLOAD_RECORDS` のとき `appended.slice(appended.length - MAX_DOWNLOAD_RECORDS)` を返す。**この updater の中で `chrome.downloads.removeFile` も `chrome.downloads.erase` も一切呼ばない**（`:77-82`）。
4. `src/background/localMarkdownExportRetention.ts:102` — `purgeExpiredDownloadRecords` の事前チェックは現リストの全レコードのみを見る。`:115-121` の lock 内 updater で `:119` の `claimed = records.filter((r) => r.createdAt <= cutoff)` を計算するため、**cap で落ちたレコードは claim の入力に存在せず**、`:123-137` の `removeFile`（`:125`）/ `erase`（`:130`）に到達できない。
5. `src/background/dailyPurgeHandler.ts:154` — 日次パージアラームから `purgeExpiredDownloadRecords` が呼ばれるが、これは上記のとおり現リストしか見えない。

**ヘッダ注释が既に示している乖離（`src/background/localMarkdownExportRetention.ts:29-31`）**

> `// Upper bound on the tracked download-id list so the record itself cannot grow`
> `// without limit. 200 ~= LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS worth of daily`
> `// flushes plus headroom for the immediate/idle timings.`

この注释が述べているのは **使用量の見積もり**であり、**強制された per-day 上限ではない**。平たく言えば `200 ≈ 30日分の日次 flush + 余裕` は「1日1回 flush なら 30 日で 30 件」という前提から導かれた値に過ぎず、`:7` の `(capped at MAX_DOWNLOAD_RECORDS, oldest dropped)` が「上限の小さいリストは正しく動くとみなしている」ことを前提にしている。監査の指摘はこれを明示する: **「ヘッダ注释の 200 ≒ 30日分の想定は使用量の見積もりであり、強制された上限ではない」**。コードは実際には強制された上限として機能しており、`:29-31` の前提（1日1回 flush）が崩れたときに削除経路が破綻する。修正の DoD にはこの注释の訂正を明文化する。

**既存テスト（現状 pin している挙動）**

- `src/background/__tests__/localExportRetention.test.ts:117-131` — `drops the oldest record when the list exceeds MAX_DOWNLOAD_RECORDS` が **cap で最古レコードが落ちる現在の挙動を pin**している（本件の Red の置き場所）。
- 同 `:81-83` — `MAX_DOWNLOAD_RECORDS = 200` を pin。`:142-158` は 29/30/31 日の境界、`:160-168` は removeFile 失敗時も erase する、`:170-185` は no-op 条件を pin。
- 同 `:188-252` — `recordDownloadId` と purge の read-modify-write 競合（`:196` の「purge が chrome.downloads で待機中に追加された id を保つ」、`:227` の同時実行マージ）を pin。**新しい削除待ちキューはこれらと同じ lock 規律を守らなければならない**。
- 同 `:47-52` — chrome スタブが `downloads: { erase, removeFile }` のみ。`downloads.search` を採用する場合（選択肢 3）のスタブ追加が必要。
- `src/background/__tests__/dailyPurgeHandler.test.ts:119-120` / `:194-195` — purge からの erase 呼び出しを pin。
- `src/background/__tests__/localMarkdownExportCore.test.ts:81` — flush 側が `recordDownloadId` を書き、purge 側が読む整合を担保する記述。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 追跡リストが 200 を超えたとき、落ちた最古レコードのダウンロードエントリが削除経路に渡る
  Given 30 日以内の createdAt を持つダウンロードレコードが 200 件追跡リストに入っている
  And   そのうち最古の downloadId が 1 である
  When  新しい flush が成功し、recordDownloadId が 201 件目を記録する
  Then  落ちた downloadId=1 のレコードは追跡リストから外れる
  And   外れ在与の同じ flush/purge 実行内で、その downloadId は削除経路（chrome.downloads.removeFile および chrome.downloads.erase）へ渡される
  And   受け入れ基準の Red を固定していた pin（localExportRetention.test.ts:117-131）は「リストから外れる」ことのみを期待し、削除は別系統として観測できる形に書き換えられている
  And   30 日 cutoff を越していないダウンロードエントリが chrome://downloads から消えることはない

Scenario: 2. 200 以下の通常動作では、すべてのエントリが 30 日 cutoff まで追跡・削除される（回帰ガード）
  Given 追跡リストのレコード数が 200 未満である
  When  flush が recordDownloadId を繰り返し呼ぶ
  Then  追加されたすべてのレコードが削除待ちの扱いを受けずに追跡リストに残る
  And   createdAt が cutoff を超えたレコードは従来どおり removeFile と erase の両方を試みる
  And   29 日前のレコードは保持され、30 日ちょうど／31 日前のレコードは削除される（localExportRetention.test.ts:142-158 の境界 pin が引き続き緑）

Scenario: 3. 削除待ちキューは service worker 再起動を跨いで失われない
  Given 追跡リストから落ちた downloadId が削除待ちキューとして永続化されている
  And   service worker がその永続化の直後に終了した
  When  次の起動後の日次 purge が走る
  Then  キューに残った downloadId は削除経路に渡され、chrome://downloads に残らない
  And   purge の途中（claim 後 / erase 前）で再起動が起きても、同じ削除待ちキューが復元される

Scenario: 4. 30 日を越えて残ったエクスポートの痕跡は定期 sweep でも回収される
  Given 追跡リストから落ち、かつ削除待ちキューにも載らなかった過去のエクスポートエントリが chrome://downloads に残っている
  When  定期 sweep が chrome.downloads.search を走らせ、記録された date / file 名に一致しない古いエクスポートエントリを判定する
  Then  条件に合致するエントリは削除される
  And   照合キーが一致しないエントリ（ユーザーの無関係なダウンロード）は**一切削除されない**
```

## 受け入れ基準

- [ ] `recordDownloadId`（`src/background/localMarkdownExportRetention.ts:79-80`）が最古レコードを落とす際、その `downloadId` が**必ず削除経路に渡る**。リストから外すだけで終わらせない（選択肢1の削除待ちキュー／選択肢2の上書き防止／選択肢3の sweep のいずれか。採用案を実装ノートに明記する）
- [ ] `:29-31` のヘッダ注释が訂正され、**「200 ≒ 30日分の想定は使用量の見積もりであり、強制された per-day 上限ではない」**という事実が明記される。加えて `:7` の `(capped at MAX_DOWNLOAD_RECORDS, oldest dropped)` が、落ちたレコードの扱いを正しく記述するよう更新される
- [ ] 削除待ちキューなど**新たな永続状態を追加する場合**、service worker 再起動を跨いで復元され、`src/background/localMarkdownExportRetention.ts:104-113` が説明する「claim してから lock 外で erase する」という設計意図（クラッシュ方向は回復可能）と矛盾しない。既存コメントの「クラッシュするとエントリが残る forever が回復可能方向」という記述が、本修正後も事実であるか再検証され、違うならコメントごと更新される
- [ ] `chrome.downloads.search` を採用する場合（選択肢3）、照合キーが `DownloadRecord` に存在しない問題（現状の形状は `{downloadId, date, createdAt}`。`src/background/localMarkdownExportRetention.ts:47-51`）を先に解消し、**照合できないエントリを削除に回さない**（fail-closed on delete）。ユーザーが自分の無関係なダウンロードを消さないことをテストで pin する
- [ ] 既存テスト `src/background/__tests__/localExportRetention.test.ts:117-131` の期待値が、本修正の挙動に合わせて**明示的に書き換えられ**、書き換えた理由がコメントで残る。あわせて `:142-158`（29/30/31 日境界）、`:160-168`（removeFile 失敗時も erase）、`:188-252`（read-modify-write 競合）が引き続き緑であることを確認する
- [ ] 新規/変更テストは `chrome.downloads` のスタブを拡張する場合、`src/background/__tests__/localExportRetention.test.ts:47-52` に `search` 等の追加分の mock が含まれ、実時間待ち（`sleep` / `waitForTimeout`）を一切含まない（`dev-docs/TEST_RULE.md`／AGENTS.md「Async / Timing Failures」）
- [ ] ロールバック時に旧追跡リスト形式が壊れないこと（読み取り不能・壊れ データ の migration を起こさない）。キュー等の新キーは**読み取りを伴わない追加キー**にして、ロールバック後も無害である
- [ ] `manifest` の権限追加が発生しないことを確認する（`wxt.config.ts:240` の `'downloads'` が既に `chrome.downloads.search` を包含する。`downloads` 権限があれば search は追加権限なしで利用できる）

## テスト戦略

- **単体**: 既存 `localExportRetention.test.ts` の storage/erase 骨組み（`:17-52` の `store` + `mockStorageGet`/`mockStorageSet`/`mockErase`/`mockRemoveFile`）を再利用する。**30日以内の 201 レコードを seed し（`:68-70` の `seedRecords` を使用）、`recordDownloadId` を1回呼んでから `purgeExpiredDownloadRecords` を実行し、落ちたレコードの `downloadId` が `removeFile`/`erase` に渡らないことを pin（＝現状の不具合を Red として固定）**。その後、修正に従って期待値を書き換える。加えて (a) 200 未満の通常動作で追加レコードが削除待ちに入らないこと、(b) 削除待ちキューが再起動を跨いで復元されること、(c) search 採用時は照合不一致のエントリを消さないこと、をそれぞれ独立ケースで pin する。キュー復元は「永続化直後に終了」する状況を mock storage の部分適用や例外 throw で表現し、実時間 sleep を使わない（`:227-251` の `useTimerClock()` 手法可用于 CAS リトライ）。
- **統合**: `flushBufferedExports → recordDownloadId` の連結。`src/background/__tests__/localMarkdownExportCore.test.ts` 相当の既存モック（`:81` の記述が示す「flush が書き purge が読む」整合）を用い、200 件超えの flush シーケンスを再現して「リストから外れかつ削除経路に渡る」ことを確認する。並行する purge（`localExportRetention.test.ts:196-225` と同じ gate パターン）でも新しい削除待ちが失われないことを確認する。
- **E2E**: owner 観測（隔離プロファイルで auto-export 有効、30 日内に 200 を超える flush-download を起こし、purge 後にエントリが残るか確認）。`findings.json` の `validation_plan.deployment` に従い、合成 fixture のみ・**観察のみで破壊的操作なし・本番プロファイルや生存靶の走査はしない**。実測項目: (a) 30 日内に 200 を超える flush が実際に起きるか、(b) cap で落ちたエントリが purge 後も `chrome://downloads` に残るか。ブラウザ側のエントリ持続はプラットフォーム挙動であり owner 観測でしか確定しない。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/background/localMarkdownExportRetention.ts` | 7 | ヘッダ「(capped at MAX_DOWNLOAD_RECORDS, oldest dropped)」— 落ちたレコードの扱いが未記述 |
| `src/background/localMarkdownExportRetention.ts` | 22–26 | 上限を UI 設定化しないという設計判断の注释（履歴窓にユーザー可視効果仅为 `chrome://downloads` 清理である旨） |
| `src/background/localMarkdownExportRetention.ts` | 27 | `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS = 30` |
| `src/background/localMarkdownExportRetention.ts` | **29–31** | **ヘッダ注释「200 ≒ 30日分の日次 flush ＋ immediate/idle の余裕」＝使用量の見積もりであり、強制された per-day 上限ではない。監査の指摘点** |
| `src/background/localMarkdownExportRetention.ts` | 32 | `MAX_DOWNLOAD_RECORDS = 200` |
| `src/background/localMarkdownExportRetention.ts` | 45 / 47–51 | `LOCAL_EXPORT_DOWNLOAD_IDS_KEY` / `DownloadRecord`（形状は `{downloadId, date, createdAt}`。search 照合に使える識別子が無い） |
| `src/background/localMarkdownExportRetention.ts` | 62–73 | `recordDownloadId` の JSDoc（read/append/cap を単一 updater で做的事と `createdAt` を lock 前に打刻する理由） |
| `src/background/localMarkdownExportRetention.ts` | **79–80** | **cap スライス。本件のバグ位置。upsert 内で erase/removeFile を一切呼ばない** |
| `src/background/localMarkdownExportRetention.ts` | 94–95 | `purgeExpiredDownloadRecords` / cutoff 計算 |
| `src/background/localMarkdownExportRetention.ts` | 102 | 事前チェック（現リストのみを見る。落ちたレコードはここで不可視） |
| `src/background/localMarkdownExportRetention.ts` | 104–113 | claim-then-erase の設計注释。「claim すると append は kept list にしか足せない」「クラッシュするとエントリが残る forever が回復可能方向」 |
| `src/background/localMarkdownExportRetention.ts` | **119** | **claim フィルタ。现リストのみが入力。cap で落ちたレコードは claim できない** |
| `src/background/localMarkdownExportRetention.ts` | 123–137 | 削除ループ。`:125` `removeFile` / `:130` `erase`（**src 内で唯一の erase 呼び出し**。`downloads.search` は src 内に存在しない） |
| `src/background/localMarkdownExportCore.ts` | 24–27 | `flushBufferedExports` シグネチャ（`filter` / `repo`） |
| `src/background/localMarkdownExportCore.ts` | 62–69 | `chrome.downloads.download` 呼び出し |
| `src/background/localMarkdownExportCore.ts` | **68** | **`conflictAction: 'overwrite'`。日付ごとに上書きなのでディスクは有界。リークするのは履歴エントリとファイル参照のみ** |
| `src/background/localMarkdownExportCore.ts` | 71–73 | `typeof downloadId === 'number'` のときのみ `recordDownloadId(downloadId, date)` |
| `src/background/localMarkdownIdleFlusher.ts` | 21 | `IMMEDIATE_DEBOUNCE_MIN = 1`（**即時 flush は最大 1回/分**） |
| `src/background/localMarkdownIdleFlusher.ts` | 20 / 58–60 / 76 | `IDLE_FALLBACK_INTERVAL_MIN = 30` / idle イベントごとに flush / 30 分フォールバックアラーム（**idle タイミングには 1日 cap が無い**） |
| `src/background/localMarkdownIdleFlusher.ts` | 81–84 | `daily` タイミングの 1440 分周期アラーム |
| `src/background/localMarkdownIdleFlusher.ts` | 114–118 | `scheduleImmediateFlush`（**キュー導入時に「1分1回」という上限发挥作用も再確認すること**） |
| `src/background/pipeline/buffers/MarkdownBufferManager.ts` | 18–23 / 33–38 | `MAX_DAILY_BUFFER_ENTRIES = 2000` とメモリ内 cap（本件とは別の軸のリソース。混同しない） |
| `src/background/pipeline/buffers/MarkdownBufferManager.ts` | 56–67 | `withAtomicKeys` で永続 daily buffer をマージ＋cap（最古ドロップ）。**「最古ドロップで無害」が成り立つのは「ファイルが同値で上書きされる」場合のみ**で、ダウンロード履歴では成り立たない。設計上の対比として有用 |
| `src/background/dailyPurgeHandler.ts` | 8 / 152–154 | `purgeExpiredDownloadRecords` の import / 日次パージからの呼び出し |
| `wxt.config.ts` | 240 | `'downloads'` 権限（**既に存在。search 追加で権限変更は不要**） |
| `src/background/__tests__/localExportRetention.test.ts` | 17–52 | 既存 storage/erase スキャフォールド。`:47-52` の chrome スタブは `erase`/`removeFile` のみで `search` は無し |
| `src/background/__tests__/localExportRetention.test.ts` | 81–83 | `MAX_DOWNLOAD_RECORDS = 200` の pin |
| `src/background/__tests__/localExportRetention.test.ts` | **117–131** | **cap で最古を落とす現在の挙動を pin（＝Red の置き場所。書き換え必須）** |
| `src/background/__tests__/localExportRetention.test.ts` | 142–158 / 160–168 / 170–185 | 29/30/31 境界、removeFile 失敗時も erase、no-op 条件 |
| `src/background/__tests__/localExportRetention.test.ts` | 188–252 | read-modify-write 競合（`:196-225` gate、`:227-251` `useTimerClock`）— 新しい削除待ちがこれらを壊さないこと |
| `src/background/__tests__/dailyPurgeHandler.test.ts` | 119–120 / 194–195 | purge からの erase 呼び出し pin |

### 最小変更の選択肢

1. **oldest-drop 時に、落ちたレコードを別の「削除待ちキュー」に積んで次の purge で erase する**
   `recordDownloadId` の updater（`:77-82`）で、スライスで落ちるレコード（`appended.length - MAX_DOWNLOAD_RECORDS` 分の先頭）を別キー（例 `local_md_export_erase_queue`）へ書き、最後の purge（`:123-137`）でキューも排出する。**最小差分**で「リストから外した＝削除した」という取り違えを直接解消できる。トレード: (a) 新しい永続キーが必要で service worker 再起動を跨いだ復元が要る、(b) `:104-113` の「claim してから erase する（クラッシュは回復可能方向）」という設計根拠と再検証が要る、(c) キュー自体に cap（古いものを超えたら境界を超えたら消すとすれば同じ問題が再発）が必要な点が「何を上限，身边の何かを消さないか」という不変条件が増えること。

2. **1日あたりの flush-download に cap を設け、cap を越えないようにしてから 200 のリスト上限に意味を持たせる（ヘッダ注释の想定と整合）**
   ヘッダ注释（`:29-31`）が暗黙に前提としている「1日1回 flush」を**実際の強制された不変条件**にする。1日あたりの記録数を N に制限すれば、200 ≒ 30日分という関係が「使用量の見積もり」ではなく「構造的に保証された関係」になる。トレード: (a) **30 日 × N 件が 200 に収まる N を選ぶ必要がある**（現状の flush 出一条/日の immediate/idle タイミングが 1日 1 flush に収まる保証は無い）ので、cap は「記録を捨てる」ことになる – 却是「エントリを残さない」方向的であり、**ユーザー可視の履歴の減り方が変わる**（副作用🔴の本体）。(b) flush 自体を落とす判断が必要になり、どのタイミングの flush を落とすかという UX 設計（i18n 含む）が要る。

3. **定期処理で `chrome.downloads.search` を走らせ、記録された date/file 名に一致しない古いエクスポートエントリを一律で erase する**
   `chrome.downloads.search` は `downloads` 権限（`wxt.config.ts:240`）で追加権限無しに使えるので、権限変更は不要。最も漏えいを確実に塞げる（追跡リストから完全に消えたエントリも回収できる唯一の案）。トレード: (a) **`DownloadRecord`（`:47-51`）に照合に使える識別子が無い**。`date` フィールドとファイル名（`localMarkdownExportCore.ts:64` の `${safeDir}/${date}.md`）を照合に使えるが、`safeDir` はユーザー設定由来（`:61` の `resolveSafeExportDir`）で照合が脆い。(b) **`chrome.downloads` はブラウザ全体のダウンロードを追う**ため照合を間違うと**ユーザーの無関係なダウンロードを消す**事故になる（副作用🔴の本体で、PBI 22 の id 再利用リスクと同種）。(c) 照合できないものは削除に回さない fail-closed が必須。(d) 現状 pin されている `:117-131` の他、複数テストの期待値変更が不可避。

推奨: **1 を第一候補（最小差分・不正確な削除を生まない）、owner の blocker 観測（下記）を先に潰す**。3 は唯一「完全に消えたエントリ」を回収できるが照合誤りの危険が副作用として大きいので、**1 の後に「1 では取れない」痕跡が残るかを owner 観測して、3 を別 PBI に切り出す**のが安全。2 は「履歴が user's 見える形で減る」ので UX 判断が先行し、実装軽いが副作用をユーザーへ突きつけるため owner の意向確認が先行。

### 着手前に潰すべき owner 確認（監査 blocker）

- **[必須] 実行環境で 30日内に 200 を超える flush-download が実際に起きるかの観測**: ソース上は即時 flush が最大 1分1回（`localMarkdownIdleFlusher.ts:114-118`）、idle flush が idle イベントごと＋30分フォールバック（`:58-60`、`:76`）で、**1日あたりの cap が無い**ため「30日内に 200 を超える」は原理的には到達可能だが、実際の flush cadence（1分あたりの記録数、idle イベントの発生頻度、flush の失敗率）はデプロイ環境観測でしか分からない。`findings.json` の `validation_plan.deployment` に従い隔離プロファイルで観測する。**200 を超えない運用であれば Reach 100 は過大**であり、RICE スコアと優先順位（および選択肢 2 の採否）を見直すこと。
- **[必須] bounded local 再現**: sandbox 可能な環境で mock-chrome により **30日以内に 201 件の seed → `recordDownloadId` 1回 → `purgeExpiredDownloadRecords` 1回**を実行し、落ちた downloadId が `removeFile`/`erase` に渡らないことを **Red として観測**する（`validation_plan.local`、既存テストのスキャフォールドを再利用するだけ）。再現できなければ実装着手を止め、`findings.json` の verdict を更新すること。
- **[推奨] 削除ポリシーの owner 意向**: 3 の「無関係なダウンロードを消しうる」リスクと 2 の「ユーザー可視の履歴が減る」変更は、どちらが許容されるかが owner 判断。1 选定情况下でも「キュー自体の cap をどうするか（ oldest ドロップの再発）」を owner と詰める。

### 落とし穴

- **既存テストが現状の挙動を pin している**: `localExportRetention.test.ts:117-131` は「最古レコードが落ちる」ことを期待値として持っている。修正時にこのテストを消すのではなく、**「リストから外れる」ことと「削除経路に渡る」ことを別系統として観測できる形に書き換える**（Red として先に固定してから Green にする）。
- **「max-drop は無害」という他モジュールの設計判断をそのまま倣わない**: `MarkdownBufferManager.ts:33-38`・`:56-67` も最古ドロップだが、これは同値のファイルを上書きする（`localMarkdownExportCore.ts:68`）ため無害。ダウンロード履歴は「上書きすると過去エントリが置き換わる」のではなく「エントリが増える」ため、同じ施策がそのまま安全とは言えない。
- **PBI 22 と同じ関数を触る**: `export-purge-erase:stale-session-download-id-dereference`（NEEDS-VALIDATION #8）は `purgeExpiredDownloadRecords` の `:125`/`:130` が保存済み `downloadId` を item identity 照合なしで参照する問題を扱う。**同じ関数・同じ行を触るため、両者を同時实施すると `:123-137` のループが二重に変更され競合する**。PBI 22 側で「照合を足す」なら、本 PBI の選択肢 1 のキューは照合関数を通す設計にしておくべき（キュー内のレコードも `downloadId` だけでは検証できないため）。
- **`chrome.downloads` はブラウザ全体のダウンロードを追う**: 選択肢 3 で照mustを間違うとユーザーの無関係なダウンロードを消す。`DownloadRecord`（`:47-51`）に照合キーがない現状のまま search で消すのは危険。**照合できないものは削除しない**（fail-closed）が必須。
- **新しい永続キーを足す場合の migration**: 既存プロファイルに新キーがないのが通常。新キーは「読み取りを伴わない追加キー」にして、ロールバック後も無害であること。壊れた value を読んだときにレコードを空扱いしてキュー全体が消えないように。
- **実時間待ちの禁止**: 新テストで `sleep` / `waitForTimeout` を使わない。CAS リトライの手は `testDir/waitPolicy.ts` の `useTimerClock()`（`localExportRetention.test.ts:232` の既存例）を流用する。

### ロールバック手順

1. 変更を `src/background/localMarkdownExportRetention.ts`（＋テスト）に閉じ込め、**storage の既存キー（`LOCAL_EXPORT_DOWNLOAD_IDS_KEY`）の形状を変更しない**。追加キーは「読み取りを伴わない追加キー」にして、ロールバック後も無害（既存フィクスチャや既存プロファイルを壊さない）。
2. ロールバック: 修正コミットを `git revert`（または reset）し、`npm run validate` で緑を確認する。ロールバックは「cap で落ちたレコードを削除しない」= **修正前の挙動**へ戻るため、それ以外の副作用（履歴の消し方の変化、ユーザーの無関係なダウンロードの削除リスク）は出さない。
3. ロールバック時に既に削除済みのエントリは戻らない（削除は不可逆）。この旨はリリースノート/Issue に明記する。
4. ロールバック後も bounded local 再現手順（`validation_plan.local`）は実行可能なまま残し、監査 fingerprint `export-download-cap:oldest-drop-leaks-unerased-entries` の verdict は `needs_validation` のまま据え置き、run-3 以降の監査に再提示できるようにする。

## 見積もり

1.5 SP（🟡中。選択肢1の削除待ちキュー＋ロック整合＋既存テスト期待値の書き換え（`localExportRetention.test.ts:117-131` 他）＋ヘッダ注释の-DoD 更新が主従で、owner blocker 観測が先行。選択肢3（`chrome.downloads.search` sweep＋照合キー設計＋無関係ダウンロード非削除の pin）は別 PBI に切り出す構成）

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（シナリオ 1〜4 すべて）
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `export-download-cap:oldest-drop-leaks-unerased-entries` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`src/background/localMarkdownExportRetention.ts` のヘッダ注释 `:7` と `:29-31` — 「200 ≒ 30日分は使用量の見積もりであり強制された上限ではない」ことを明記）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: 30 日以内の 201 レコード（id 0..200）を seed して `recordDownloadId(9999)` を呼ぶとリストは 200 件に cap され、**先頭 2 件（id 0 / id 1）が脱落**する。その後 `purgeExpiredDownloadRecords()` を実行しても **`removeFile` / `erase` は一度も呼ばれない**（全レコードが cutoff 内のため早期 return。仮に走っても cap 落ちレコードは claim 入力に存在しない）
- 影響: 「cap で落ちたレコードはどの削除経路からも見えない」ことを決定論的に再現。機制版では expired レコードのみが消えることを確認済み

## 関連

- `pbi/00-INDEX.md`
- 同じ retention 領域の PBI 22（purge erase の id 再利用、fingerprint `export-purge-erase:stale-session-download-id-dereference`）と併せて設計する（同じ関数 `purgeExpiredDownloadRecords` の `:123-137` を触るため、同時実施は競合する。PBI 22 側で「照合を足す」なら本 PBI のキュー内のレコードも照関数を通す設計に統一する）
- 監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` の needs_validation エントリ / `NEEDS-VALIDATION.md:189-219` の「## 7.」/ 同 `:221-249` の「## 8.」＝ PBI 22）
- 先行 PBI: `2026-10-18-02-fix-alarm-daily-purge-recreate.md`（日次パージアラーム側の retention 接続点、`dailyPurgeHandler.ts:154`）
- 先行 PBI: `2026-10-18-07-fix-buffer-key-retention-sweep-noop.md`（同じ retention 領域の buffer キー側の sweep）