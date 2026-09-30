# PBI: ローカル Markdown export の retention 強化と download-id 記録の RMW 競合修正

## ユーザーストーリー

ユーザーとして、Markdown export のダウンロードが失敗し続けても storage が際限なく成長し続けないようにしたい。なぜなら失敗時の孤児バッファに回収経路がなく、加えて flush のたびに全 storage を読むため孤児数に比例して O(N) に劣化するからだ。

## ビジネス価値

- export 失敗が継続する環境で `chrome.storage.local` が無期限に膨らむのを抑え、他の storage 利用者（設定・SQLite 関連・pending pages）に対するクォータ圧迫を回避する。
- flush 時の全 storage 読み込みが孤児数に比例して遅くなる退行を、孤児数を有界にすることで抑える。
- `recordDownloadId` と `purgeExpiredDownloadRecords` の read→write 競合で、記録が消える／復活する事故を塞ぐ。
- 「失敗時に消さない」という正しい既存判断を壊さずに、回収を別経路（保持期限 sweep）として構造的に分離する。
- 保持日数は定数として明示し、ユーザー設定に露出させない判断をコードで固定する。

## 優先度

- 種別: fix
- 順位: 6 / 17
- RICEスコア: 9.0（Reach=3 / Impact=3 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 保持期限を超えた孤児バッファが回収される
  Given 10 日前の日付の local_export_YYYY-MM-DD キーが download 失敗により残っている
  And 保持期限内の日付のキーが同時に残っている
  When 日次 sweep が走る
  Then 保持期限より古い local_export_ キーが削除される
  And 保持期限内のキーは削除されない
  And sweep は chrome.downloads に一切呼び出さない

Scenario: 当日と前日の未 flush バッファを sweep が消さない
  Given 当日の local_export_YYYY-MM-DD キーが未 flush で残っている
  And 前日のキーも未 flush で残っている
  When 日次 sweep が走る
  Then 当日と前日のキーは日付比較により保護され削除されない

Scenario: flush 成功時の即時削除は変わらない
  Given ある日付のバッファがあり download が成功する
  When flush がその日付を処理する
  Then 成功直後に該当キーが削除される（VULN-004 の現行挙動を維持）

Scenario: flush 失敗時にその場でキーは消さない
  Given ある日付のバッファがあり download が失敗する
  When flush がその日付を処理する
  Then その場ではキーを削除しない
  And エラーをログに記録する
  And 回収は保持期限 sweep のみが担当する

Scenario: flush と日次 sweep が同時に走っても記録が失われない
  Given 同時に 2 つの処理が download-id リストを読み書きする
  When 片方が新 ID を記録し、もう片方が期限切れレコードを purge する
  Then 新 ID が消失しない
  And 削除対象だったレコードが復活しない

Scenario: 孤児が蓄積しても flush コストが線形に収まる
  Given 回収 sweep により local_export_ キーの個数が保持期限で有界になっている
  When flush が走る
  Then 処理する日数は有界であり、無制限増加した孤児を読み込む必要がない
```

## 受け入れ基準

- [x] `local_export_` プレフィックスのキーを列挙し、保持期限（定数）を超えたキーのみ削除する回収 sweep を実装し、`dailyPurgeHandler` の日次処理から呼ぶ。
- [x] 回収 sweep は日付文字列を保持期限の基準日と比較し、当日と前日の未 flush バッファを保護する。保持日数は既存 export retention の定数と並べて明示する。
- [x] 回収 sweep は `chrome.storage.local.remove` のみを使用し、`chrome.downloads`（`removeFile` / `erase`）には触れない。
- [x] `localMarkdownExportCore` の「成功時のみ `chrome.storage.local.remove(key)`」という挙動を変更していない。`src/background/__tests__/localMarkdownExportCore.test.ts:172` の VULN-004 pin を維持する。
- [x] `recordDownloadId` と `purgeExpiredDownloadRecords` の read→push/slice→set を `withOptimisticLock` 経由の 1 回の更新へ置き換え、単一プロセス内で直列化されている。
- [x] RMW 修正は既存契約（lock key への version 非 bumping 直接 set 禁止、`withOptimisticLock` 経由）に従い、lock key を直接 set していない。
- [x] `chrome.storage.local.get()`（全 storage 取得、flush ごと）の維持理由をコメントに残す。削減は動的キーのため今回行わない。
- [x] `npm run validate` が成功し、既存の retention / download-id 記録のテストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「export が失敗し続けても、日次処理が几日かで過去分を回収し、flush の待ち時間が伸びない」観測点を確認する。
- 新しいユーザー機能（export の挙動変更）は追加しない。成功時のファイル出力が変わらないことを Outside-In の観測点とする。
- 当日のファイルが回収対象にならないことを、実日付で観測する。

### 統合テスト

- `flushBufferedExports`（`src/background/localMarkdownExportCore.ts:24`）と日次 sweep の連続実行で、保持期限内のバッファが保持され、期限超過分が回収されることを確認する。
- `localMarkdownExportCore.test.ts:172` の「download 失敗時にキーを消さない」pin と、「成功時に消す」pin の両方を維持・検証する。
- `localExportRetention.test.ts`（`MAX_DAILY_BUFFER_ENTRIES = 2000` の pin を含む）の既存期待値と、後から追加する sweep の期待値の間で矛盾がないことを確認する。
- `purgeExpiredDownloadRecords` の slow path（`chrome.downloads.removeFile` / `erase` を await）と、`flushBufferedExports` の `recordDownloadId`（`src/background/localMarkdownExportCore.ts:72`）が同時に走っても、双方向の RMW が成立することを確認する。
- `handleDailyPurgeAlarm`（`src/background/dailyPurgeHandler.ts:22`）が既存の sweep 群（`clearExpiredPages` → settings backup → `purgeExpiredDownloadRecords`）に追加の sweep を含めて 1 パスで動くことを確認する。

### 単体テスト

- キーの日付部分抽出（`local_export_YYYY-MM-DD` → `YYYY-MM-DD`）と保持期限比較を純粋関数として検証する。当日・前日・境界日（期限ちょうど）を含める。
- 当日・前日の保護判定を境界ケース付きで検証する。
- `recordDownloadId` の新 ID 追加・古い ID の切り捨て（`MAX_DOWNLOAD_RECORDS` 超過時）が 1 回の lock 更新内で完結することを検証する。
- `purgeExpiredDownloadRecords` が新 ID を保持したまま期限切れレコードを削除し、`chrome.downloads` の失敗を握りつぶす挙動を維持することを検証する。
- ロック競合を再現するテスト（read 直後に別 write を差し込む）を作り、RMW の一元化で取りこぼしが起きないことを確認する。

## 実装アプローチ

- **Outside-In**: まず「保持期限を超えた孤児が回収され、当日は保護される」という日次 sweep の外部観測点を failing として書き、green にする。
- **Red-Green-Refactor**: `localMarkdownExportCore.test.ts:172`（失敗時に消さない）を Red として維持したまま、回収を「失敗時に消す」のではなく「別 sweep で回収する」形に Green にする。
- **RMW の一元化**: `recordDownloadId` と `purgeExpiredDownloadRecords` をそれぞれ `withOptimisticLock` 内の 1 回の updater に収め、「読む→計算する→書く」を分割しない。
- **修正項目の分離**: (1) 孤児バッファ retention sweep、(2) download-id の RMW 競合の 2 点を 1 PBI で扱いつつ、コード上は独立した関数として分離する。片方の修正が他方の前提にならないようにする。
- **スコープの限定**: `chrome.storage.local.get()`（無引数 = 全取得）を flush ごとに実行する判断は今回維持する。バッファキーは動的で列挙されていない（`localMarkdownExportCore.ts:36-41` のコメント）ため、列挙による絞り込みは行わない。

## 見積もり

**1 SP**

1. 孤児バッファの回収 sweep（キー列挙、日付解析、保持期限比較、当日/前日保護、`dailyPurgeHandler` への接続）が 0.5 SP。2. `recordDownloadId` / `purgeExpiredDownloadRecords` の `withOptimisticLock` 化（lock key への version 契約を含む）が 0.3 SP。3. 関連テスト（sweep 単体、競合再現、既存 pin の維持確認）が 0.2 SP。`chrome.storage.local.get()` の全取得維持と UI / i18n 変更は含まない。

## 技術的考慮事項

- 孤児の発生源は `src/background/localMarkdownExportCore.ts:78` の `chrome.storage.local.remove(key)` が成功時のみ実行される設計である（`:37-47` のコメント「Only reached when download() ... succeeded」）。`src/background/localMarkdownExportCore.ts:84-86` の per-date catch はログのみを残し、キーを残す。
- 回収経路は存在しない。`src/background/dailyPurgeHandler.ts:22-75` は SQLite / legacy pages / settings backup / download-ID を掃除するが、`local_export_*` を列挙しない。production でプレフィックスに触れるのは `src/background/localMarkdownExportCore.ts` と `src/background/pipeline/buffers/MarkdownBufferManager.ts` のみである。
- 「失敗時に消さない」判断は正しい（消すと当日データを失う）。過去 PBI `dev-docs/archived/pbi/2026-08-29-17-fix-local-export-retention.md:20` が「フラッシュ後も `local_export_*` キーが残る場合、retention なしに蓄積」を背景として認識しつつ、acceptance をスコープ外にした。本 PBI はその retention を「失敗時の即削除」ではなく「保持期限 sweep」として実装する。
- 成長率の根拠は、1 日バッファ上限 `MAX_DAILY_BUFFER_ENTRIES = 2000`（`src/background/pipeline/buffers/MarkdownBufferManager.ts:17-25`）× エントリデータ（`src/utils/markdownFormatter.ts:127-140`）≒ 1.4〜2.2MB / 孤児 / 日である。`mode` を manual に切り替えた日以降のバッファも孤児化する。
- O(N) 退行の源は `src/background/localMarkdownExportCore.ts:42` の `chrome.storage.local.get()`（無引数 = 全 storage 取得）が flush ごとに走り、孤児 N 日分を毎回メモリに載せることである。孤児数を有界にすることで N が有界になるが、読み込み方式自体は今回は変えない。
- RMW 競合の実体は `src/background/localMarkdownExportRetention.ts:37-56`（`recordDownloadId`）と `:67-92`（`purgeExpiredDownloadRecords`）が、どちらも lock 無しの read→push/slice→set である。
- 呼び出し元 A は `src/background/localMarkdownExportCore.ts:72`（flush ごと）、呼び出し元 B は `src/background/dailyPurgeHandler.ts:71`（daily alarm）。purge の slow path（`removeFile` / `erase` を await）は複数 await を挟むため、その間に flush の write が interleave すると新 ID 記録が失われたり、削除済みの記録が復活したりする。正規形は `withOptimisticLock`（利用例 `src/utils/pendingStorage.ts:221`）。
- 保持日数は `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS = 30`（`src/background/localMarkdownExportRetention.ts:22`）に並ぶ別定数として置く。バッファ保持と download 記録保持は別のリソースであり、同一値に束縛しない。バッファ側は例 7 日。
- `src/background/pipeline/steps/saveLocalMarkdownStep.ts:22` の `DAILY_BUFFER_PREFIX = 'local_export_'` をプレフィックスの SSOT として使う。回収 sweep はここを再利用する。
- 保持済み pin: `src/background/__tests__/localMarkdownExportCore.test.ts:172`（VULN-004、download 失敗時にキーを消さない）。回収 sweep は「失敗時に即消す」のではなく「保存済みデータを download した後 or 保持期限経過後に回収」として実装する。
- `MAX_DOWNLOAD_RECORDS = 200`（`src/background/localMarkdownExportRetention.ts:27`）の切り捨ては `recordDownloadId` 側の責務である。purge 側へ移動しない。

## 実装者向け注記

### 現状コードの確認

- `src/background/localMarkdownExportCore.ts:78` の `remove` は `:37-47` のコメントどおり download 成功後にのみ到達し、`:84-86` の per-date catch はログのみ。したがって download が失敗し続けた日は `local_export_YYYY-MM-DD` が残り続ける。
- `src/background/dailyPurgeHandler.ts:22-75` の処理順は `clearExpiredPages` → SQLite record purge → content purge → `cleanupExpiredSettingsBackups`（`:67`）→ `purgeExpiredDownloadRecords`（`:71`）。新 sweep はこの末尾に足す。
- `src/background/localMarkdownExportRetention.ts:37-41` の `readRecords` は `chrome.storage.local.get(LOCAL_EXPORT_DOWNLOAD_IDS_KEY)` で単一キーを読む。`:48-55` と `:91-92` が無 lock の read→write になっている。
- `src/background/pipeline/steps/saveLocalMarkdownStep.ts:22` がプレフィックス定義の SSOT である。回収 sweep はここを import する。
- `src/background/pipeline/buffers/MarkdownBufferManager.ts:17-25` に VULN-004 由来の上限 2000 と「古い順を捨てる」方針のコメントがある。回収側の上限とは別の制御である。
- `src/background/__tests__/localExportRetention.test.ts` が download-id 記録（retention / 上限）の既存 pin を持ち、`:134` で `MAX_DAILY_BUFFER_ENTRIES = 2000` を pin している。

### 実装手順

1. 保持済み pin を確認する。`src/background/__tests__/localMarkdownExportCore.test.ts:172` が「download 失敗時にキーを消さない」ことを検証している。この Red を維持したまま進める。
2. バッファ保持日数（例 7 日）の定数を置く。既存 `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS`（download 記録用）とは別定数にする。
3. キーの日付抽出と保持期限比較の純粋関数を作る。`local_export_YYYY-MM-DD` から日付を取り出し、当日・前日を保護し、期限超過を判定する。
4. 回収 sweep 関数を作る。`chrome.storage.local.get(DAILY_BUFFER_PREFIX)` でプレフィックスを列挙し、期限超過分のみ `chrome.storage.local.remove(keys)` する。`chrome.downloads` には触らない。
5. `src/background/dailyPurgeHandler.ts` の日次処理の末尾に新 sweep の呼び出しを追加する。失敗時は既存の try/catch で握りつぶす（他 sweep と同じ扱い）。
6. 回収 sweep の単体テストを書く。当日 / 前日 / 期限ちょうど / 期限超過 / プレフィックス外キーの 5 ケース。
7. RMW 競合の Red を作る。`recordDownloadId` の read 直後に `purgeExpiredDownloadRecords` の write を差し込み、新 ID が消える状態を確認する。
8. `recordDownloadId` と `purgeExpiredDownloadRecords` を `withOptimisticLock` 内の 1 回の updater へ書き換える。lock key へ直接 set せず、version bump は `withOptimisticLock` に任せる。
9. 競合解消のテストを green にする。`localExportRetention.test.ts` の既存 pin と矛盾しないことを確認する。
10. `src/background/localMarkdownExportCore.ts:36-41` の全取得コメントに、保持期限 sweep によりバッファキー数が有界になった旨を追記する。
11. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- sweep を「失敗時に消す」方向に実装すると、当日のデータを失う。既存の `localMarkdownExportCore.test.ts:172` の pin が壊れる。回収は保持期限 sweep としてのみ行う。
- sweep の日付比較で当日と前日を保護しないと、その日の夜間に未 flush の当日データが回収される。境界（当日・前日・期限ちょうど）を明示的にテストする。
- 回収 sweep で `chrome.downloads.removeFile` / `erase` を呼ぶと、export 済みファイルの削除という別の副作用に踏み込む。sweep は `chrome.storage.local.remove` のみとする。
- RMW 修正で lock key へ直接 `set` すると、version が bumping されない中途半端な更新になり、既存契約テスト（lock key への version 非 bumping 直接 set 禁止）に抵触する。`withOptimisticLock` の updater 内で完結させる。
- `purgeExpiredDownloadRecords` の slow path（複数 await）を lock 内に持ち込むと、外部 API の待ち時間だけ lock を占有する。副作用（`removeFile` / `erase`）は lock 外、リスト更新だけを lock 内に置く。
- バッファ保持日数と `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS`（download 記録用 30 日）を同一視すると、片方の意図的外れで他方の保持が消える。別定数とする。
- 全 storage 取得（`src/background/localMarkdownExportCore.ts:42`）を keyed get に置き換えると、`local_export_YYYY-MM-DD` が見つからなくなる（`:36-41` のコメントが commit 195ff96 の事故を記録している）。今回は変更しない。
- `MAX_DOWNLOAD_RECORDS` の切り捨てを purge 側へ移すと、記録追加時の上限制御が失われる。`recordDownloadId` の責務として維持する。
- `DAILY_BUFFER_PREFIX` を sweep 側で再定義すると、プレフィックスが 2 箇所の SSOT になる。import で共有する。

## 決定事項

1. 孤児バッファが発生する理由は、`src/background/localMarkdownExportCore.ts:78` のキー削除が download 成功時のみ実行され、`:84-86` の per-date catch はログのみを残し、再試行や回収の経路が存在しないためである。
2. 回収経路が存在しない理由は、過去 PBI `dev-docs/archived/pbi/2026-08-29-17-fix-local-export-retention.md:20` が「失敗時に消さない」判断を正しいものとしてスコープ外にしたためである。回収は別の判断として未実装のまま残っていた。
3. flush が遅くなる理由は、`src/background/localMarkdownExportCore.ts:42` の無引数 `chrome.storage.local.get()` が flush ごとに走り、孤児 N 日分を毎回メモリに載せるためである。バッファキーは動的なため keyed get への絞り込みは行わない。
4. RMW 競合が顕在化しない理由は、`recordDownloadId` は flush ごと、`purgeExpiredDownloadRecords` は daily alarm と呼び出し頻度が異なり、`src/background/localMarkdownExportRetention.ts:37-56`、`:67-92` が lock を持たないためである。purge の slow path が await を挟むため、書き手と読み手が割り込む窓が開く。
5. 「失敗時に消さない」という判断は維持し、回収は保持期限 sweep として `dailyPurgeHandler` に追加する。回収は `chrome.storage.local.remove` のみを行い、`chrome.downloads` には触れない。
6. バッファ保持日数は export download 記録の `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS`（30 日）とは別の定数とし、例 7 日とする。当日と前日は日付比較で保護する。
7. 全 storage 読み込みの方式は今回変更しない。孤児数を有界にすることが本 PBI の主眼であり、バッファは「保存済みデータを download した後 or 保持期限経過後に回収」として扱う。
8. RMW は `withOptimisticLock` の 1 回の updater へ一元化し、外部 API 副作用（`removeFile` / `erase`）は lock 外に置く。lock key への直接 set は行わない。
9. `MAX_DOWNLOAD_RECORDS` の切り捨ては `recordDownloadId` の責務として維持し、purge 側へ移動しない。

## Definition of Done

- [x] `local_export_` キーの回収 sweep が実装され、`src/background/dailyPurgeHandler.ts` の日次処理から呼ばれている。
- [x] sweep は保持期限超過分のみ削除し、当日と前日の未 flush バッファを保護する。
- [x] sweep は `chrome.storage.local.remove` のみを使い、`chrome.downloads` に触れない。
- [x] `src/background/localMarkdownExportCore.ts:172` の VULN-004 pin（download 失敗時にキーを消さない）が維持され、成功時の即時削除も変更されていない。
- [x] `recordDownloadId` と `purgeExpiredDownloadRecords` の RMW が `withOptimisticLock` の 1 回の updater に統合され、lock key への直接 set がない。
- [x] flush と日次 sweep の並行実行で、新 ID の消失・削除済み記録の復活が起きないことをテストで確認している。
- [x] 回収 sweep の単体テスト（当日 / 前日 / 期限ちょうど / 期限超過 / プレフィックス外）が green である。
- [x] `npm run validate` が成功し、既存の retention / download-id 記録のテストに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
