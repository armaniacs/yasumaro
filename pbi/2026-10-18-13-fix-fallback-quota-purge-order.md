# PBI: Fallback のクォータ purge を dedupe 判定の後ろへ移し、star 行を exempt して「書かないのに消える」を止める

## ユーザーストーリー

OPFS が使えない環境（Firefox プライベートモードなど）で閲覧履歴を溜めている利用者として、**同じ URL を再記録しただけ、あるいは通信が1往復ロストしただけで、古い履歴が消えない**ことを保証してほしい。履歴保持は継続的な保存という行為なのに、与えたデータが消える理由が「その記録が重複だった」「リトライされた」だけだったからだ。消す行はユーザーが明示的にスターを付けたものでもない。

さらに、まだ履歴を失いたくない利用者として、**容量が，正常に埋まったときの巻き添え対象が非スター行に統一されている**ことを望みたい。保持期間 purge（`purgeOldRecords`）は `is_starred === 1` を exempt しているのに、クォータ purge は exempt していない。同じ「古い順に捨てる」ポリシーが2つあるのに判定基準が食い違っているため、ユーザーがどちらの扱いを期待すべきか判断できない。

## 優先度

- 順位: 13 / 25
- RICE: 1000（Reach=200 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査13位。`ensureQuotaSpace` が `insert` / `insertBatch` の dedupe 判定より前に走るため、dedupe で「書かなかった」ケースでも purge は既に永続化されている。しかも `ensureQuotaSpace` は ①`is_starred` を exempt しない（兄弟の保持期間 purge は exempt する）②`getBytesInUse(null)`（全 `chrome.storage.local` キー）を使って Fallback キーだけをしぼる ③「行数」で Byte を測る、の3つの不揃いがあり、そして ④purge 後のロールバックが無い。結果、重複やロスト応答リトライ（`MAX_RETRY_COUNT = 5`）が 5MB のソフト閾値を超えているとき、1試行ごとに最古の10%が star 込みで消え、何も書かれない。`wxt.config.ts:231` の `unlimitedStorage` があるため 5MB は自己申告的な閾値であり、これは容量不足が起きたからではなく「消してよい」根拠が不在のまま削除が走る、という欠陥である。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴あり（削除ポリシーの変更。star 付き行の扱いが変わるため、保持期間 purge との一貫性を確認する必要がある。具体的には `purgeOldRecords` の `maxRecords` 分岐（`:393-395`）は現状 star を exempt していないため、「どの purge が star を残すか」を一貫した形に決めるまで受け入れ基準2を満たさない。加えて quota 超過時に無制限に purge できなくなるため、全行がスター済み・削除済みで間引ける対象が無い場合の挙動を明示する必要がある）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `storageFallback.ensureQuotaSpace:purge-before-dedupe-unstarred`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 23番 / `findings.json` 29件中の1件、verdict: `needs_validation`）。

claimed root cause（監査原文）: "The purge is ordered before the dedupe/insert outcome and is not conditioned on the write actually landing, and it drops the oldest rows without the `is_starred` guard its sibling purge applies."

- [entrypoint] `src/background/pendingSqliteQueue.ts:147`（recording and retry ingress）— `sqliteClient.mutate({ type: 'insertBatch', records })`。`MAX_RETRY_COUNT = 5`（`:37`、`:57` で `maxRetryCount` として適用）が1回の記録ごとに最大5試行まで放大する。
- [propagation] `src/offscreen/FallbackStorageAdapter.ts:11` — `insert` は素通しで、判定を挟まない。`:15-19` の `insertBatch` は `{ inserted, skipped }` に写すだけで、`:134` の purge は素通りする。
- [propagation] `src/offscreen/storageFallback.ts:107` / `:134` — `ensureQuotaSpace()` が `loadData()` と dedupe 判定より**前**に走る。
- [propagation] `src/offscreen/storageFallback.ts:90-94` — 最古10%を ①star exempt 無し・②byte ではなく行数基準・③`:94` で即 `saveData` して永続化、の形で実行する。
- [sink] `src/offscreen/storageFallback.ts:111`（`return { success: true, id: -1 }`）/ `:149`（`return { success: true, count: 0 }`）— dedupe 経路は「成功」を返し、その前に走った purge を取り消さない。

**ロスト応答リトライとの接続**: `src/background/sqlite/offscreenGateway.ts:105-107` に "Retry safety is owned by the neutral policy table. A lost response can follow a committed write" と書かれており、応答ロストは「コミット済み write の後に起こりうる」ことが transports 側で明示されている。`src/background/pipeline/steps/saveSqliteStep.ts:75` が insert を発行し、`:76-78` で失敗時に `enqueuePendingRecord` へ積む。つまり「同じ batch を再度 insertBatch する」経路は正常系として存在する。

**注意（id churn の副次影響）**: `ensureQuotaSpace` が `:94` で永続化した後、`insert` は `:108` で `loadData()` を読み直すため、**purge で消えた重複行は dedupe 判定に掛からず、新規行として新しい id で再挿入される**。この場合は同じ内容の行が残るが、元 id を持つ行（`update` / `toggleStar` / `delete` の対象）は失われる。dedupe に掛かった（= purge 対象外の）場合は純粋な削除になる。どちらの枝でも1試行あたり最古10%分の行が失われる点は共通する。

## BDD受け入れシナリオ

1. **Scenario: quota 逾逾中も、重複の再記録では1行も消えない**
   - **Given** 5MB のソフト閾値を超えている fallback ストアに 20 行が保存されている（そのうち最古の2行が purge 対象）
   - **And** 再記録する URL は「最古の2行」ではなく新しい側の行と `url` + `created_at` が一致している
   - **When** その URL を再度 `insert` する（dedupe 経路）
   - **Then** 結果として `success: true` と `id: -1` が返ること（既存の戻り値契約は変わらない）
   - **And** **保存済み 20 行が1行も削除されないこと**（purge が走らない、または走っても復元される）
   - **And** `MAX_RETRY_COUNT = 5` 回繰り返しても行数が減少しないこと（幾何級数的減少が起きないこと）

2. **Scenario: quota 超過で本当に新しい記録が必要なとき、最古の非スター行だけ間引かれる**
   - **Given** 5MB のソフト閾値を超えている fallback ストアに 20 行が保存されている（最古の2行のうち1行は `is_starred: 1`）
   - **When** 既存に存在しない新しい URL を `insert` する（実際に書き込みが確定する経路）
   - **Then** 新規行が挿入され、記録数は 20 行のままになること
   - **And** **間引かれるのは `is_starred !== 1` の行だけであること**（スター行は兄弟 purge の保持期間分岐（`purgeOldRecords` `:381-382`）と同じ基準で残る）
   - **And** 「quota purge で消える行はスター行ではない」ことが保持期間 purge と同じ判定基準で表現されていること

3. **Scenario: insertBatch が全件重複でも、purge の永続化が残らない**
   - **Given** 5MB のソフト閾値を超えている fallback ストア
   - **When** 保存済み URL のみを含む batch を `insertBatch` する（全件 dedupe 経路）
   - **Then** `{ success: true, count: 0 }` が返ること
   - **And** 保存済み行が1件も削除されないこと

4. **Scenario: 容量判定は fallback キー自身のバイト数で行う**
   - **Given** `chrome.storage.local` には fallback 以外のキー（設定・`savedUrlsWithTimestamps` など）も保存されている
   - **When** quota 判定が走る
   - **Then** 判定に使うバイト数は fallback キー（`FALLBACK_STORAGE_DATA`）の実績値であり、`getBytesInUse(null)` の全キー合計ではないこと
   - **And** 間引き量が「行数の10%」ではなくバイト数の実績として説明できること

5. **Scenario: 間引ける対象が無いとき、黙って既存データを壊さない**
   - **Given** 5MB のソフト閾値を超えているが、すべての行が `is_starred: 1`（間引き対象が無い）
   - **When** 新しい URL を `insert` する
   - **Then** スター行を削除せず、純粋な容量エラー（または明示的な失敗）として扱われること

## 受け入れ基準

- [ ] `src/offscreen/storageFallback.ts:107`（`insert`）と `:134`（`insertBatch`）の `ensureQuotaSpace()` 呼び出しが、dedupe 判定の**後**、書き込みが確定する位置へ移っていること。`:99-103` のコメント（PBI 2026-08-27-06 の「dedupe 判定 THEN ID 確保」順序）は新順序に合わせて更新すること
- [ ] quota purge が `is_starred === 1` を exempt しており、兄弟 purge（`purgeOldRecords` の保持期間分岐 `:381-382`、`purgeContent` の `:427` / `:444`）と同一の基準で表現されていること。`purgeOldRecords` の `maxRecords` 分岐（`:393-395`）が star を exempt していない点は、**本 PBI で揃えるか対象外として理由を記録するか**を実装時に裁定すること
- [ ] quota 判定が `getBytesInUse(null)`（`:86`）ではなく対象キー指定、または行数ベースの推定ではなくバイト実績を使っていること
- [ ] dedupe 経路（`:111` の `id: -1` / `:149` の `count: 0`）から purge の結果が永続化されないこと。実装方式（呼び出し位置の変更で自然に解消するか、明示的なロールバックが必要か）を裁定し、裁定内容をコードコメントに残すこと
- [ ] purge 後・書き込み確定後に `saveData` が失敗した場合、`:31` の `saveData` 契約（失敗した書き込みは永続化されない）と整合し、半書きの blob が生じないこと
- [ ] purge による削除が観測できること（ログまたは戻り値）。現状は不可視なので、owner が事後に「何がいつ消えたか」を追えること
- [ ] 既存 pin が壊れないこと: `storageFallback-branches.test.ts:34-54`（「新規 insert で最古1行が purge される」。新規 URL を使うため新順序でも成立する）と `storageFallback.test.ts:24-27`（重複 insert が `{ success: true, id: -1 }`）
- [ ] 「quota 超過中の重複 insert では1行も消えない」pin が追加され、`npm run validate` が緑であること。対象テストは `npx vitest run src/offscreen/__tests__/storageFallback.test.ts src/offscreen/__tests__/storageFallback-branches.test.ts --repeats=20 --retries=0` で緑（AGENTS.md の繰返し実行規約）。実時間待ち・固定 sleep・retry 数の持ち上げをテストに導入していないこと

## テスト戦略

- 単体: `chrome.storage.local.getBytesInUse` を 5MB 超えで返し、既に存在する URL（かつ purge 対象外の新しい側）で `insert` を呼ぶ → **何も削除されない**ことを pin（シナリオ1）。続いて新規 URL で `insert` し、**スター行が残る**ことを確認（シナリオ2）。`insertBatch` の全件重複で `count: 0` かつ1件も消えないことを pin（シナリオ3）。間引き対象が全てスター行の場合に削除が走らないことを pin（シナリオ5）。`getBytesInUse` に渡される引数が `null` でないことを spy の呼び出し引数で直接 assert する（シナリオ4）。既存スタイル（`src/offscreen/__tests__/storageFallback-branches.test.ts`）に倣う: `makeRecord()` ヘルパ（`:14-22`）と `vi.spyOn(chrome.storage.local, 'getBytesInUse') as unknown as {...}` のキャスト形式（`:39-43` / `:58-60`）。
- 統合: `FallbackStorageAdapter` → `storageFallback` の `insert`（`FallbackStorageAdapter.ts:11`）と `insertBatch`（`:15-19`、`inserted` / `skipped` の写像）経由で通し実行し、dedupe 時に `skipped` が立ち行数が変わらないことを確認。`pendingSqliteQueue` 側は「同一 batch の再送」を1ケース模擬し、5回再送しても行数が減らないことを確認。
- E2E: owner 観測（OPFS が無効な Firefox プライベートモードで fallback データが 5MB を超えた状態）。**Fallback データが 5MB を超える状態を owner が実際に作れるか**が本 PBI のブロッカー（後述）。E2E に 5MB のシードを自動化すると実行時間と CI 負荷が跳ね上がるため、owner 手動観測を E2E の受け皿とする。E2E に実時間 sleep は入れず、環境の readiness は上限つきポーリングで待つ。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認済み）

| ファイル | 行 | 現状 |
|---|---|---|
| `src/offscreen/storageFallback.ts` | 17 | `QUOTA_BYTES_LIMIT = 5 * 1024 * 1024; // 5MB warning threshold`。`unlimitedStorage` があるため自己申告的な閾値 |
| `src/offscreen/storageFallback.ts` | 25-34 | `loadData()` / `saveData()`。`saveData` は `chrome.storage.local.set` 1回 |
| `src/offscreen/storageFallback.ts` | 85-95 | `ensureQuotaSpace()` 本体 |
| `src/offscreen/storageFallback.ts` | 86 | `getBytesInUse(null)` — 全 `chrome.storage.local` キーの合計を測る。下ろすのは `FALLBACK_STORAGE_DATA` だけ |
| `src/offscreen/storageFallback.ts` | 87 | `if (bytesInUse <= QUOTA_BYTES_LIMIT) return;` |
| `src/offscreen/storageFallback.ts` | 90 | `purgeCount = Math.max(1, Math.floor(data.records.length * 0.1))` — **行数**で Byte を測っている |
| `src/offscreen/storageFallback.ts` | 91-93 | `created_at` 昇順で最古 `purgeCount` 行を id 集合で除去。`is_starred` による除外は無い |
| `src/offscreen/storageFallback.ts` | 94 | `await this.saveData(data)` — ここで purge が永続化される。以降の dedupe return で取り消されない |
| `src/offscreen/storageFallback.ts` | 99-103 | 「dedupe 判定 THEN ID 確保」の順序が `mutate` を使えない理由として書かれたコメント（PBI 2026-08-27-06）。順序変更時に要更新 |
| `src/offscreen/storageFallback.ts` | 104-125 | `insert()`。`:107` = `ensureQuotaSpace()`、`:108` = `loadData()`、`:109` = dedupe 判定、`:111` = `{ success: true, id: -1 }`、`:122` = 実際の `saveData` |
| `src/offscreen/storageFallback.ts` | 131-170 | `insertBatch()`。`:134` = `ensureQuotaSpace()`、`:137` = `existingKeys` 構築、`:148-150` = 全件重複で `{ success: true, count: 0 }`、`:167` = 実際の `saveData` |
| `src/offscreen/storageFallback.ts` | 371-400 | `purgeOldRecords()`。`:382` = 保持期間分岐の `if (r.is_starred === 1 || r.is_deleted === 1) return true;`（**兄弟の exempt 基準**） |
| `src/offscreen/storageFallback.ts` | 393-395 | 同じ関数の `maxRecords` 分岐。`is_deleted === 0` のみ抽出し、`is_starred` は exempt していない（**本 PBI で揃えるか裁定が必要**） |
| `src/offscreen/storageFallback.ts` | 427 / 444 | `purgeContent()` の `filter(r => r.is_starred !== 1)` — 2つ目の star exempt の先例 |
| `src/offscreen/FallbackStorageAdapter.ts` | 11-13 | `insert` は `this.fallback.insert(record)` を素通し |
| `src/offscreen/FallbackStorageAdapter.ts` | 15-19 | `insertBatch` は `{ inserted, skipped }` へ写像するのみ |
| `src/background/pendingSqliteQueue.ts` | 37 / 57 | `MAX_RETRY_COUNT = 5` / `maxRetryCount` の適用 |
| `src/background/pendingSqliteQueue.ts` | 143-154 | `flushBatch` 内の `sqliteClient.mutate({ type: 'insertBatch', records })`（`:147`）— 同じ batch の再送経路 |
| `src/background/sqlite/offscreenGateway.ts` | 105-107 | 「A lost response can follow a committed write」— リトライが再入する根拠 |
| `src/background/pipeline/steps/saveSqliteStep.ts` | 75-78 | insert の発行と、失敗時の `enqueuePendingRecord` |
| `wxt.config.ts` | 231 | `'unlimitedStorage'` — 5MB は自己申告的 |
| `src/offscreen/__tests__/storageFallback-branches.test.ts` | 33-68 | `describe('FallbackStorage quota management')` — purge の既存 pin 2件 |
| `src/offscreen/__tests__/storageFallback-branches.test.ts` | 34-54 | 「新規 insert で最古1行が purge される」pin。新順序でも緑になるはず |
| `src/offscreen/__tests__/storageFallback.test.ts` | 24-27 | 重複 insert が `{ success: true, id: -1 }` を返す pin |

### 最小変更の選択肢

1. **`ensureQuotaSpace` を dedupe 判定の後、実際に書き込みが確定したときに限り呼ぶ** — 推奨。`insert` は `:108-111` の dedupe 早期 return の後、`getNextId()`（`:112`）の前。`insertBatch` は `:148-150` の `toInsert.length === 0` return の後、`allocateIds`（`:153`）の前。`:99-103` のコメントが述べる「dedupe 判定 THEN ID 確保」の順序にそのまま素直に一致し、`mutate` の純関数契約も破らない。
2. **`is_starred` exempt を追加して兄弟 purge（`:382`）と揃える** — `:92` の `sorted` を作る時点で `r.is_starred !== 1` を除外する。`:427` / `:444` の `filter(r => r.is_starred !== 1)` と同じ形の表現に寄せる。
3. **`getBytesInUse(null)` ではなく対象キー指定のバイト数を使い、「行数」で Byte を測っている部分を修正** — `getBytesInUse(STORAGE_KEY)`（`:86`）で Fallback キー自身のバイト数を測る。`:90` の `purgeCount` を「何バイト減らしたいか」から逆算するのが本筋だが `JSON.stringify` の実測コストがあるため、まず「閾値判定の粒度を正しくする（対象キー指定）」だけを最小変更とし、間引き量のバイト基準化は別 PBI に分ける。**どちらの粒度までやるかを痕跡記録すること。**

**推奨: 1 と 2 を必ず実装し、3 は「対象キー指定」までを本 PBI のスコープにする。** 4（ロールバック）は選択肢1を採用すれば構造的に不要になる（purge 後の dedupe return が起きなくなるため）。ただし purge 後に `saveData` が失敗し得ることを受け入れ基準で明示し、半書き防止を担保する。

### 既存テストの書式と pin の追加位置

- 追加先は **`src/offscreen/__tests__/storageFallback-branches.test.ts` の `describe('FallbackStorage quota management')`（`:33-68`）の直前または直後**。既に `makeRecord()` ヘルパ（`:14-22`）と `getBytesInUse` の spy キャスト形式（`:39-43`）が揃っており、同じ `describe` 内に並べると差分が最小になる。
- `src/offscreen/__tests__/storageFallback.test.ts` には重複 pin 群（`:24-27`）があるため、「quota 超過中の重複 insert で1行も消えない」は `describe('insert')` 内ではなく branches 側の quota 専用 `describe` に置くのが整合的。
- グローバル setup は `testDir/vitest.setup.ts:187` で `getBytesInUse: true`（有効化済み）。既定値は `testDir/__tests__/storageMock.test.ts:94-97` を見る限り `1024` なので、閾値未満は既定で成立する。
- `vi.useFakeTimers()` の既定オプションは使わない（AGENTS.md の待機方針）。本 PBI のテストはストレージ I/O のモックなのでタイマー制御は不要。既存 branches テスト（`:35-37`）がループで連続 insert している点を引き継ぐ場合も、何も追加しなくてよい。

### 落とし穴

- **`Math.max(1, ...)`（`:90`）の1行下限**: star exempt を入れると候補が0行になったとき、`Math.max(1, 0)` により1行が消える。exempt 後は `if (purgeCount === 0) return;` のような早期 return を入れるか、下限値を候補数に対して取る。
- **id churn**: `ensureQuotaSpace` が `:94` で保存した後、`:108` で読み直すため、purge で消えた重複行は dedupe に掛からず新しい id で再挿入される。`update` / `toggleStar` / `delete` は id 指定なので、**行数が減らない場合でも id が入替わる**ことがある。「消えない」ことを pin するテストで id の一致まで見るべきかは実装時に裁定する。
- **コメントの陳腐化**: `:99-103` は「ensureQuotaSpace と allocateIds は dedupe check の後で append より前」という順序を記録している。順序を変えるとコメントが嘘になるので必ず同時に更新する。

### ブロッカー（着手前に潰すべき owner 確認）

1. **実行環境で 5MB のソフト閾値を実際に超えることを観測できるか** — needs_validation の blockers そのもの。`wxt.config.ts:231` の `unlimitedStorage` があるため 5MB は自己申告的で、`chrome.storage.local` の実際の制約ではない。**owner が OPFS 無効環境で 5MB 以上の fallback データを実際に作れるか（どの操作で、どの程度の記録数・どの record で到達するか）** が未観測であり、これが Reach=200 の前提そのものである。到達できなければ、発火条件が現実のユーザー体験として到達可能かを裁定し、Reach / Impact を再採点する。
2. **全行がスター済みのときの実害** — 選択肢2の exempt 導入後、間引き対象が0行になるケースが現実にあるか（採点履歴をユーザーが全てスターする使い方はあるか）。無ければシナリオ5は「明示的な失敗」に縮約してよいが、「黙って既存データを壊さない」ことは守る。
3. **`purgeOldRecords` の `maxRecords` 分岐（`:393-395`）を本 PBI で揃えるか** — 受け入れ基準2の「兄弟 purge と同一の基準」を完全にするにはこの分岐にも star exempt が必要だが、`maxRecords` の意味論（明示的に上限件数で切る）は保持期間と異なり、スター行を残すと上限件数が守られない。**どちらの意図が正しいかを owner が裁定する**（本 PBI のスコープ外と裁定するなら、理由をコードコメントと `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md:33, :63` に記録する）。

いずれも owner 確認として着手前に対応する（source-only 実行境界のもと未確認のまま「直した」としない）。

### ロールバック手順

1. 変更は `src/offscreen/storageFallback.ts` の `ensureQuotaSpace`（`:85-95`）と `insert`（`:104-125`）/ `insertBatch`（`:131-170`）の呼び出し位置、`purgeOldRecords`（`:371-400`）の exempt 判定、および新規 pin テストに限定する。ストレージキー構造・manifest・権限には触れないためデータ移行は不要。
2. ロールバックは上記 hunk を戻すだけで足りる。ただし**既に本 PBI 之前的実装で削除済みの行は復元できない**（履歴は fallback ストレージにのみ永続化されるため）。ロールバック時に想定する報告は「消えた記録が復活しない」であり、それは本 PBI が直す欠陥そのものである。
3. 移行期の安全弁として「quota 超過を検知したら記録を止め、`getStatus` やダッシュボードに明示警告を出す」方向に拡張する場合、その追加は別 PBI とし、本ロールバック手順の影響を受けない形で分離する。
4. 回帰が疑われる場合は `npx vitest run src/offscreen/__tests__/storageFallback.test.ts src/offscreen/__tests__/storageFallback-branches.test.ts --repeats=20 --retries=0` を単発実行し、purge 関連4ファイル（`storageFallback.test.ts` / `storageFallback-branches.test.ts` / `storageFallbackMutate.test.ts` / `storageFallback-comprehensive.test.ts`）をまとめて確認する。

## 見積もり

1.0 SP（人週 3 日）。ブロッカー1-3 の owner 確認（各 0.5-1 時間）→ 選択肢1+2 の実装（2-4 時間）→ 受け入れ基準2（maxRecords 分岐の裁定）と選択肢3（対象キー指定）の実装（1-2 時間）→ BDD シナリオ1-5 の pin 追加（3-4 時間）→ `npm run validate` とレビュー（2 時間）。ブロッカー1で閾値到達が不可能と判定され、選択肢3をスコープ外にした場合は 0.5 SP（人週1.5日）相当まで縮む。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint を完了記録に残す（`storageFallback.ensureQuotaSpace:purge-before-dedupe-unstarred`）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md:33, :63` の「`chrome.storage.local`（5MB 警告閾値・10% 自動 purge）」という記述を実装後の挙動に合わせる）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: 20 行 seed・`getBytesInUse`=6MB で、既存 url+created_at の insert（挿入 0 件・`{success:true,id:-1}`）でも **20 行が 18 行に減少**して永続化された。削除対象は id 1（`is_starred:1` の **star 行込み**）と id 2 で exempt なし。連続 5 回の重複 insert で行数が **`[18,17,16,15,14]`** と幾何的に減衰する
- 影響: purge-before-dedupe・star exempt なし・幾何減衰の 3 点を実測で確定

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md:33, :63` — fallback の 5MB 警告閾値・10% 自動 purge を記述している既存ドキュメント（DoD の更新対象）
- `dev-docs/archived/pbi/2026-07-18-19-fix-storage-quota-unlimited-storage-check.md` — `unlimitedStorage` 権限下での 5MB 定数そのものを対象にした先例 PBI（`src/utils/storage/quota.ts` 側）。本 PBI の「自己申告的な閾値」論点と共有する
- `src/offscreen/__tests__/storageFallback-branches.test.ts:33-68` — quota purge の既存 pin（修正後に緑でなければならない）
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`findings.json` / `NEEDS-VALIDATION.md` 23番 / `FINDINGS-DETAIL.md`）