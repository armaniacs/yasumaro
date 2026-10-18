# PBI: retention purge が保存済み downloadId を再照合せずに removeFile / erase する（再起動後に id が他項目へ再割当されると無関係な個人ファイルを削除する）

## ユーザーストーリー

個人ユーザーとして、ローカル Markdown 自動エクスポートの 30 日以上古いダウンロード削除が「記録した自分のエクスポート」だけを消し、ブラウザ内の他のどのダウンロードにも触れないようにしてほしい。なぜなら `chrome.downloads` はブラウザ全体のダウンロードを追跡しており、id が別物に再割当された瞬間に**自分の個人ファイルが消去される**から。retention は「古い自分の生成物を片付ける」ための処理であり、そこから外れた削除は取り返せないから。

## 優先度

- 順位: 22 / 25
- RICE: 300（Reach=100 / Impact=0.5 / Confidence=50% / Effort=0.4）
- 根拠 / 種別: 🔧非機能追加（fix） / 難易度: 🟡中 / 副作用: 🔴あり
  - 種別・難度の根拠: 記録の照合ロジックと migration を伴う非機能修正。`purgeExpiredDownloadRecords` は既に `withOptimisticLock` で直列化され、`removeFile` / `erase` を lock 外で待つ設計（`localMarkdownExportRetention.ts:104-113`）が固いため、触るのは「削除前に照合を 1 段挟む」と「レコードに項目同定情報を 1 つ足す」の 2 点に収まる。ただし後者は既存レコードの移行という未知数が入る。
  - 副作用「🔴あり」の根拠: 本修正はユーザーの個人ファイル削除の可否そのものを決める。**誤判定 1 件で別人の（自分の）無関係なファイルを消す**ため、受け入れ基準とテスト戦略の両方に「消さないことの保証」を明示している。逆向きの失敗（何も消さない）は 30 件の `chrome://downloads` エントリが残るだけで、復元可能側。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `export-purge-erase:stale-session-download-id-dereference`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/

- 判定: `needs_validation`（NEEDS-VALIDATION.md 8番 = REPORT 220-248 行目）
- claimed root cause: erase ステップが保存済み `downloadId` を逆参照するだけで（`localMarkdownExportRetention.ts:125` `:130`）、erase 時点でその id が記録項目を指しているかを rebinding しない。レコード `{downloadId, date, createdAt}` も erase 呼び出しも、そのチェックを一切持たない。
- 伝播: `createdAt` フィルタで claim しただけでは **レコード** が確定するだけで、`chrome.downloads` の**項目**は確定しない。レコードは `chrome.storage.local` に残り、ブラウザ再起動をまたいでも消えない。
- sink: `removeFile` は新ファイルの削除を、`erase` は新エントリの消去を行う。`chrome.downloads` はユーザー自身の全ダウンロードを追跡するため、被害は retention の 30 日境界を越えた deletion になる。
- セッション内では新しいダウンロードに新しい id が振られるため現状設計は安全。露見は「セッションをまたいで id が再割当されうるプラットフォーム」= Firefox ビルドに残る（Chromium は `DownloadItem.id` がセッションをまたいで持続すると文書化されているが、この run では再検証できず）。

## BDD受け入れシナリオ

```gherkin
Scenario: 1: 保存済み id が記録項目を指していないとき purge は何も削除しない
  Given 30日以上前に記録されたエクスポートのダウンロードレコードがあり、
        そのダウンロードはすでに存在しない（id が別のセッションの無関係な新しいダウンロードに再割当されている）
  When  daily purge が走る
  Then purge はその downloadId に対して removeFile を呼ばない
  And  purge はその downloadId に対して erase を呼ばない
  And  照合で消せなかったエントリは、ユーザーが `chrome://downloads` で自分の手で消せる形に残り、
        黙って捨てない（残した旨がログに残る）

Scenario: 2: 同一セッション内で記録した項目が 30 日を超えた場合は従来どおり削除する（回帰ガード）
  Given 30日以上前に記録され、purge 実行時点でその downloadId が
        記録どおりの項目（記録したファイル名と一致）に解決される
  When  daily purge が走る
  Then purge は removeFile と erase をその downloadId に対して呼ぶ
  And 29日 / 30日 / 31日 の保持境界、および removeFile が失敗しても erase を試す既存挙動は変わらない

Scenario: 3: 照合そのものの不確定（search が空・search が失敗）は「安全側」で削除しない
  Given 30日以上前のレコードがあり、項目同定のための検索が空結果を返すか
        API エラーで解決できなかった
  When  daily purge が走る
  Then purge は removeFile も erase も呼ばない
  And  検索失敗と「一致する項目なし」をログで区別できる（切り分けのため）
```

## 受け入れ基準

- [ ] `purgeExpiredDownloadRecords` が `removeFile` / `erase` を呼ぶ前に、**その `downloadId` が記録項目に紐づくことを確認する**こと。確認できない場合は両方とも呼ばない。
- [ ] **誤ってユーザーのファイルを消さないことを保証する**: 照合が通らない経路では `chrome.downloads.removeFile` の呼び出し回数が 0 であることを単体テストで pin し、readiness を gate にする（`npm run validate` で緑が必須）。
- [ ] 同一セッション内で記録され 30 日を超えた項目は、従来どおり `removeFile` → `erase` が呼ばれること（回帰ガード）。既存の 29/30/31 日境界テストと「removeFile が reject しても erase を試す」テストの意図を弱めない。
- [ ] 照合失敗と項目不一致はログで区別できること（現状の `Local Markdown download record erase failed`（`:132`）とは別のイベントとして）。
- [ ] 既存レコード（項目同定情報を持たない旧フォーマット）を読み込んだ場合にも、同一の照合経路を通ること。旧レコードのために削除が恒久的に無効化されないこと。
- [ ] 照合の実装は `downloads` 権限の追加を必要としないこと（`wxt.config.ts:240` の `'downloads'` は無条件。Chromium / Firefox 両ビルド）。
- [ ] 30 日を超えた purge で「照合が通らず消せなかったエントリ」をユーザーが自分で救える手段があること（残った `chrome://downloads` エントリはユーザーが手動で消せる。黙って消さないことが主眼で、テストか仕様で示すこと）。

## テスト戦略

- 単体: `src/background/__tests__/localExportRetention.test.ts` に、**id 再利用を偽造した mock-chrome テスト**を追加する。既存スタブ（`:47-52` の `vi.stubGlobal('chrome', …)`）には `downloads: { erase, removeFile }` しか無く、`search` も無いので、まずスタブを追加する。そのうえで (a) 照合が空結果／別項目を返すとき `removeFile` / `erase` が 0 回であることの pin、(b) 照合が通るとき従来どおり呼ばれることの pin、(c) 旧フォーマット（項目同定情報なし）レコードでも照合が効くことの pin、の 3 本を追加する。**同一セッション内の通常削除の回帰ガード**は既存 `:142-168` の 2 テストが担うが、`search` スタブ 追加で期待値側の更新が必要になる（= 意図的な更新であり、pin を外す更新ではない）。
- 統合: `src/background/dailyPurgeHandler.ts:152-154` の daily-purge alarm から `purgeExpiredDownloadRecords` までを 1 パスとして通し、照合処理が例外を投げても他の sweep を落とさないこと（`:163-165` の `catch` で吸収されること）を確認する。
- E2E: **owner 観測**。隔離 Firefox プロファイルで拡張を読み込み、(1) ダウンロード id を記録 → (2) ブラウザ再起動 → (3) 別のファイルを再ダウンロード → (4) id が再利用されるかを観察する。再利用が見られたら、衝突する id を持つ 30 日以上前のレコードを seed し、purge を 1 回走らせて挙動を観察する。実ターゲットへの probing は行わず、owner 自身の隔離プロファイルで完結させる。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイル確認 / HEAD `56f1d7c1`）

| ファイル | 行 | 該当箇所 |
|---|---|---|
| `src/background/localMarkdownExportRetention.ts` | `:45` | `LOCAL_EXPORT_DOWNLOAD_IDS_KEY = 'local_md_export_download_ids'`（永続化の保存先） |
| 同上 | `:47-51` | `DownloadRecord { downloadId; date; createdAt }` — **項目同定の情報が無い**ことの根拠（監査 evidence） |
| 同上 | `:27` | `LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS = 30` |
| 同上 | `:74-83` | `recordDownloadId`。`:75` で `{ downloadId, date, createdAt: Date.now() }` を生成し、`:77` の `withOptimisticLock` 内で append + cap |
| 同上 | `:95` | `cutoff` の算出 |
| 同上 | `:102` | 安価な事前判定（lock を取らない no-op パス） |
| 同上 | `:104-113` | claim-then-erase の設計コメント。並行 append と crash 方向は扱うが、**ブラウザ再起動をまたぐ id 同一性は扱っていない**（監査 evidence） |
| 同上 | `:114-121` | `withOptimisticLock` 内での claim。`:119` が `claimed = records.filter(r => r.createdAt <= cutoff)` |
| 同上 | `:123` | `for (const record of claimed)` — 副作用ループ |
| 同上 | `:125` | `await chrome.downloads.removeFile(record.downloadId)` — **sink 1**。照会なし直接逆参照 |
| 同上 | `:126-128` | removeFile の失敗を握りつぶす（harmless と明記） |
| 同上 | `:130` | `await chrome.downloads.erase({ id: record.downloadId })` — **sink 2** |
| 同上 | `:131-136` | erase 失敗時の `addLog(LogType.ERROR, 'Local Markdown download record erase failed', …)` |
| `src/background/dailyPurgeHandler.ts` | `:8` | `purgeExpiredDownloadRecords` の import |
| 同上 | `:152-154` | VULN-004 コメント + `await purgeExpiredDownloadRecords();`（**purge の唯一の呼び出し元**） |
| 同上 | `:163-165` | 全体を囲む `try/catch`。照合処理の例外はここで吸われる |
| `src/background/localMarkdownExportCore.ts` | `:61` | `const safeDir = resolveSafeExportDir(exportPath);` |
| 同上 | `:62-69` | `chrome.downloads.download({ url: dataUrl, filename: \`${safeDir}/${date}.md\`, saveAs: false, conflictAction: 'overwrite' })` — **ファイル名は決定論的** |
| 同上 | `:71-73` | `if (typeof downloadId === 'number') await recordDownloadId(downloadId, date);` |
| `src/background/__tests__/localExportRetention.test.ts` | `:47-52` | `vi.stubGlobal('chrome', …)`。`downloads` は `erase` と `removeFile` のみ（**`search` なし**） |
| 同上 | `:142-158` | 29/30/31 日境界 + erase 期待値（回帰ガード） |
| 同上 | `:160-168` | removeFile が reject しても erase を試す pin |
| 同上 | `:196-251` | `recordDownloadId` との read-modify-write 競合 2 ケース |
| `wxt.config.ts` | `:240` | `permissions` に `'downloads'` が**無条件**に含まれる（Chromium / Firefox 共通） |

補足（実ファイルで確認した事実）:

- `src/` 全体に `downloads.search` の呼び出しは**ゼロ**。監査 evidence「no search call exists anywhere in src」のとおり。したがって照合は新規依存であり、`chrome.downloads.search` は `downloads` 権限のままで呼べる。
- `localMarkdownExportCore.ts:64` の `filename` は `${safeDir}/${date}.md` で決定論的だが、**`safeDir` はユーザー設定 `exportPath` 由来**（`:61`）。ユーザーは設定を変えるので、**purge 時に filename を再計算する方法は可靠しない**。項目同定情報は記録時に保存するのが正しい。

### 最小変更の選択肢

1. **レコードに項目同定の情報を足し、erase 前に `chrome.downloads.search` で再照合してから削除する**
   - 変更量: `DownloadRecord` に `filename`（と必要なら `bytes` / `mime`）を追加し、`recordDownloadId` の引数に 1 つ足す → `localMarkdownExportCore.ts:72` の呼び出しを 1 行変更（`safeDir` は `:61` に既にある）。`purgeExpiredDownloadRecords` に照合 1 段を挿入。
   - 利点: 照合の基準が「時刻の近さ」ではなく「ファイルの名前」そのものなので、**同定根拠が明示的でレビューしやすい**。id が他項目に再割当されていても名前が違えば確実に弾ける。
   - 難点: **旧レコードには `filename` が無い**。移行手段が要る（下記「旧レコードの扱い」）。
   - 軽量形（スキーマ変更なしの補強）: `search({ id })` が返す `DownloadItem.startTime` を `record.createdAt` と照合する。`createdAt` は `download()` 直後に `Date.now()` を打った値（`retention.ts:75` / `core.ts:62`→`:72`）で、`startTime` とは秒スケールしか変わらない。新鮮なダウンロードに id が再利用されたなら `startTime` は「現在」で、`createdAt` は「30 日以上前」なので差が桁違いに大きい。**旧レコードにもそのまま効く**。
   - **推奨: 1 の本形（filename 保存）と軽量形（startTime 照合）を併用する。** filename がある新レコードは filename で照合し、ない旧レコード（および照合基準が欠けたケース）は startTime で照合する。どちらでも「照合できないなら削除しない」で閉じる。

2. **セッション id を記録して（新セッションで不一致なら削除しない）ガードを入れる**
   - 変更量: 記録に「そのセッションで採番された」印を 1 つ足し、purge 時に現在セッションと突き合わせる。
   - 利点: 実装は軽く、`chrome.downloads` への追加照会が要らない。
   - 難点: **「セッション」とは何かをコードで定義できない**（service worker の生存 session とブラウザのセッションは別物）。印の置き場を service worker の起動ごとに採番する、あるいは設定保存時に採番する、どちらもブラウザ再起動に正確に対応しない。**判定基準として信頼できないので推奨しない**。

3. **Chromium の持続 id 前提に立てば Firefox だけ別扱いにし、Firefox でのみ search 再照合を行う**
   - 変更量: `wxt.config.ts` の `env.browser` で分岐（`:234` / `:217` と同形）。
   - 利点: Chromium 側は挙動不変。
   - 難点: **「id は持続する」という前提そのものが未検証**（ブロッカー）。前提が崩れた日に素通りする。同じコードを 2 ブラウザで 2 通りに書くリスクも残る。
   - 評価: **非推奨。** 安全側の実装（選択肢 1）ならChromium 側でも無害に走らせられる。

**総合推奨: 選択肢 1（filename 保存 + startTime 照合、旧レコードは startTime で救う）。** 1 本で両ブラウザを同じコードで閉じ、選択肢 3 の「ブラウザ別分岐」を持ち込まずに済む。

### 旧レコード（項目同定情報を持たない）の扱い

ここが移行で唯一厄介な論点。選択肢は 3 つ:

- **(a) 旧レコードを照合なし削除（現状維持）** — 露見が残る。非推奨。
- **(b) 旧レコードを削除しない** — 安全側だが、**削除されないエントリが無期限に残る**（`chrome://downloads` に 200 件超の残骸が滞留する）。PBI 21 と同じ「cap で落とされないエントリ」型の課題を持ち込むことになる。
- **(c) 旧レコードは startTime 照合で判定する** — スキーマ変更なしで照合経路を通せる。**推奨。** `filename` が無い場合でも `createdAt` と `startTime` の比較だけで「id が 30 日後に別のダウンロードに回ってきた」ケースは確実に弾ける。

(c) を採るなら、**「旧レコードを恒久的に削除不能にしない」こと**は受け入れ基準項目として残す（= 「旧フォーマットを読んでも照合経路を通ること」）。

### 「ユーザーのファイルを消さない」ことの検証（基準とテストの双方）

- **受け入れ基準側**: 上記「誤ってユーザーのファイルを消さないことを保証する」1 項を gate にする。`npm run validate` が緑であることは「照合が通らない経路で `removeFile` が 0 回」を含む。
- **テスト戦略側**: 単体テストの Scenario 1 / 3 がこの保証の pin であり、**期待値は「呼ばない」**。加えて既存テストの `mockRemoveFile` / `mockErase` 呼び出し回数を `toHaveBeenCalledTimes(0)` で明示的に pin する（`not.toHaveBeenCalled()` ではなく回数で残すのは、後から別のコードパスが 1 回だけ呼ぶ不回帰を捕まえるため）。
- **レビュー時の合言葉**: 「この diff のどこを直すとユーザーの個人ファイルが消えるか」を 1 行で言えること。答えが「照合を通した時だけ消える」でなければ実装不十分。

### 着手前に潰すべき owner 確認（ブロッカー）

**この PBI の最大リスクは実装ではなく、事実未確定**である。着手前に owner が次の 1 点を確定させること:

> **対象プラットフォーム（特に Firefox）は、ブラウザ再起動後にダウンロード id を別のダウンロードへ再割当しうるか？**

- 現状把握: Chromium は `DownloadItem.id` がセッションをまたいで持続すると文書化されている（この run では再検証できず）。**Firefox ビルドの `browser.downloads` の id セマンティクスはソースから不可視**で、決定的な証拠が本 run の外にある。
- 解消手段（監査の validation plan 準拠）: 隔離 Firefox プロファイルで「id 記録 → ブラウザ再起動 → 別ファイルの再ダウンロード → id の再利用有無」を観察する。再利用が見られれば、本件は実在の欠陥として確定する。
- **事実が確定しない場合の実装方針**: **再照合を常に適用し、不確定なら「安全側（削除しない）」に倒す**ことを推奨する。照合のコストは `chrome.downloads.search({ id })` 1 回 × claim 済みレコード数（最大 200）で、日次 1 回の alarm 上では無視できる。**不確実性を理由に照合を省略する実装を本 PBI では受け入れない**（=選択肢 3 は選ばない）。当該方針は受入基準とテスト戦略にも「空結果・API エラーは削除しない」として明記済み。

### ロールバック手順

- 変更は 1 ファイル（`localMarkdownExportRetention.ts`）+ 呼び出し 1 行（`localMarkdownExportCore.ts:72`）+ テスト 1 ファイルに閉じる。`git revert` で戻せる。
- ストレージスキームの変更は**追加フィールドのみ**（`DownloadRecord` に `filename?` を足す形）で、旧レコードの読み込みは壊れない。revert 後も**照合なしの削除（現状の挙動）に戻るだけ**で、保存済みデータは壊されない。
- ロールバック時に確認すること: `chrome.storage.local` に旧キーが残るだけで、移行を戻す必要は無い（読み出しの `toRecords`（`:53-55`）は配列キャストのみで検証しないため、余分なフィールドを気にしない）。

## 見積もり

3 SP（単位: ストーリーポイント）

内訳の目安: 照合ロジック + レコードへの項目同定情報の追加 = 1.0 / 単体テスト 3 本 + 既存テストの `search` スタブ追加 = 0.8 / ログ整備（不一致・search 失敗の区別） = 0.3 / ドキュメント（`dev-docs/`  retention 記述 + CHANGELOG）= 0.4 / owner 確認（owner 側の Firefox 観測時間）は**別枠**（工数に含めない。ブロッカー解消を待つ時間は開発工数と分けて扱う）。

※ ブロッカー（プラットフォーム事実）が未確定のまま実装着手する場合でも、安全側に倒す実装は 3 SP のまま着手できる。確定を待つ場合は owner 確認の完了が着手条件。

## Definition of Done

- [ ] BDDシナリオ（3 本）が自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `export-purge-erase:stale-session-download-id-dereference` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

## 調査結果（2026-10-18）

- 判定: **CONFIRMED（Firefox 限定の実在欠陥）**
- 決め手: 局所再現で、`recordDownloadId` が書くレコードのキーは **`['createdAt','date','downloadId']` のみ**（filename/url を記録しない）ことを pin。expired レコード（id 777）を seed し `chrome.downloads.search` をスタブに足しても、purge は **search を 0 回しか呼ばず** `removeFile(777)` / `erase({id:777})` を直接実行する。加えて Chrome docs は `DownloadItem.id` を「persistent across browser sessions」とする一方、**Firefox は起動時に 1 から採番し直し**、ソースに `TODO Bug 1247794`（未解決）が残る
- 影響: Chromium では安全、**Firefox ビルドでのみ実害**。**Reach 100→30、Confidence 50→100（RICE 300→38）**。選択肢 1（filename 保存 + `startTime` 照合）が妥当と確定。「照合できないものは削除しない」原則を DoD に残すこと

## 関連

- `pbi/00-INDEX.md`
- 同じ retention 領域の PBI 21（cap で落ちた未削除エントリ）と同じファイルを変更するため、実装順とファイル所有に注意
- `pbi/2026-10-18-07-fix-buffer-key-retention-sweep-noop.md` — 同じ retention 領域（`local_export_YYYY-MM-DD` バッファキー回収）。`dailyPurgeHandler.ts` の sweep 列処理順を共有するため、**purge 順序の競合に注意**。
- `pbi/2026-10-18-13-fix-fallback-quota-purge-order.md` — 「消える前に判定する」同種の安全側方針。書式と guard の言い回しを揃える。
- `pbi/2026-10-18-10-fix-opfs-v2-verify-before-delete.md` — 「verify before delete」の先例（移行前に照合してから削除）。本 PBI も同じ型で、rollback 方針の記述を合わせられる。
- `src/background/localMarkdownExportRetention.ts`（VULN-004 の本体）/ `dev-docs/ARCHITECTURE_MAP.md` / `dev-docs/TEST_RULE.md`（テスト追加前に必読）