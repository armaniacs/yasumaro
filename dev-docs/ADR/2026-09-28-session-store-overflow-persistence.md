# ADR: session store フラッシュ上限の裁定 — 3 MiB 引き上げ + 恒久滞留ループの構造的断絶

## ステータス
採用（裁定のみ。実装は後続 PBI）

## 日付
2026-09-28

## 作成者
PBI 2026-09-28-12（investigate）

## コンテキスト

`SessionStore` は `chrome.storage.session` への書き込みを writeQueue にまとめ、フラッシュ時に
`estimateStorageSize()`（`new Blob([JSON.stringify(value)]).size`）でサイズを測り、
`MAX_SESSION_SIZE = 1 * 1024 * 1024` を超えていれば優先サブキーのみ書いて、残りを writeQueue へ戻す
（`src/background/sessionStore.ts:181-198,245-274`）。

問題は 3 点ある。

1. **上限が実測に基づかない固定値 1 MiB である。** 書き込み元の最大ペイロードは
   `MAX_URL_SET_SIZE = 10000`（`src/utils/urlEntry.ts:9`）で、これは「件数」の上限であって
   「バイト」の上限ではない。URL 文字列の長さは無制限なので、1 MiB は正当なペイロードを確実に切り落とす。
2. **超過は 1 回きりの逸脱ではなく恒久状態になる。** 戻されたキーは次回 flush でも同じサイズでキューから
   取り出され、同じ分岐を通る。検証で確認した（下記「実測」）。
3. **超過状態のコストが flush ごとに発生する。** `estimateStorageSize` はキュー全体を毎回フル serialize する。

### 既存 spec（pbi/2026-09-28-12）との前提の相違（実測で判明）

spec は「10,000 URL 相当で urlCache JSON が 1.0〜1.1MB」「保存 URL が 9,000 件で記録が恒久的に非永続化される」
と前提としていた。実測はいずれも成立しない。

- **エントリの実形が違う。** `PersistedCacheState.urlCache` の型は `[string, number][]`
  （`src/background/recordingCache.ts:34`）で、要素は `[url, timestamp]` である
  （`getSavedUrlsWithTimestamps()` が `Map<url, ts>` を返す: `src/utils/storage/savedUrlRepository.ts:137-145`、
  `UrlCache` は `Map<string, number>`: `src/background/cache/UrlCache.ts:10`）。
  `SavedUrlEntry` 全体（content / aiSummary / token 統計など）は session には載らない。
- **10,000 件での実サイズは 0.664〜1.923 MiB（URL 長依存）** で、「1.0〜1.1 MiB」は
  URL が 84〜100 文字のときだけ成立する。上限 1 MiB は 132 文字なら 6,898 件で、
  180 文字なら 5,201 件で超える。つまり **10,000 件よりずっと前に超過する**。

### 実測（Node v26.10.0 / macOS、`/tmp` の throwaway harness、実装は変更していない）

投入した payload は `recordingCache.saveCacheToSession()` と同じ形
（`{settingsCache, cacheTimestamp, cacheVersion, urlCache, urlCacheTimestamp, privacyCache, privacyCacheTimestamp}`、
`privacyCache` 200 件、`settingsCache` は redact 済み相当）を `sw:recordingCache` キーに包んで作っている。

**A. 1 万件での直列化サイズ（`sw:recordingCache` 全体、`new Blob([JSON.stringify()])` 実測）**

| URL 文字数 | bytes | KiB | MiB | 1 MiB 超 | 2 MiB 超 | 3 MiB 超 | bytes/件 |
|---|---|---|---|---|---|---|---|
| 48  | 696,058   | 680  | 0.664 | -    | -    | -    | 69.6  |
| 76  | 976,058   | 953  | 0.931 | -    | -    | -    | 97.6  |
| 84  | 1,056,058 | 1,031 | 1.007 | **超** | - | - | 105.6 |
| 100 | 1,216,058 | 1,188 | 1.160 | **超** | - | - | 121.6 |
| 132 | 1,536,058 | 1,500 | 1.465 | **超** | - | - | 153.6 |
| 180 | 2,016,058 | 1,969 | 1.923 | **超** | - | - | 201.6 |
| 240 | 2,616,058 | 2,555 | 2.495 | **超** | **超** | - | 261.6 |
| 320 | 3,416,058 | 3,336 | 3.258 | **超** | **超** | **超** | 341.6 |
| 500 | 5,216,058 | 5,094 | 4.974 | **超** | **超** | **超** | 521.6 |

1 件あたり `urlBytes + 21.6` バイト（傾き 1.0 で厳密線形）。上限 1 MiB なら
**83 文字超の URL で 1 万件が容量に収まらなくなる**。

**B. 上限別のカバレッジ（1 万件で収まる URL 長）**: 1 MiB → 83 文字 / 2 MiB → 188 文字 / 3 MiB → 293 文字。

**C. 恒久ループ（実 `SessionStore` に mock `chrome.storage.session`、10,000 件 × 132 文字 = 1.47 MiB）**

10 回連続 flush で **毎回ちょうど 1 回** `chrome.storage.session.set()` が呼ばれ、毎回 **2,715 バイト**
（優先サブキーのみ）しか書かれ、`writeQueue` は毎回 1 キー（`sw:recordingCache`）を保持したままだった。
1 回きりではないことが確認できた。

**D. flush コスト（実 `SessionStore`、200 回連続 over-cap flush）**: 合計 199.9 ms / 207.5 ms（2 計測）、
**1.00〜1.04 ms / flush**。単体の `estimateStorageSize` は 1 万件で p50 0.5〜1.3 ms
（内訳は `JSON.stringify` 0.51 ms + `Blob` 0.09 ms、n=40、p95 は 2.6 ms）。
transient メモリは 1 万件で 20 flush あたり RSS 差 13.4 MiB = **672 KiB / flush**
（JSON 文字列 976,390 char = UTF-16 で 1.86 MiB + Blob コピー約 0.93 MiB）。

**E. suspend 経路への波及（実測）**: `service-worker.ts:105` が `registerSuspendHandler` を登録しているため、
恒久滞留した writeQueue は SW 停止のたびに `emergencyFlushToLocal()` を通り、
**1,496,644 バイト（1.427 MiB）の `sw:recordingCache` が `chrome.storage.local` に書き出される**（urlCache ごと）。
さらに 1.43 MiB の `JSON.stringify`（p50 0.72 ms / p95 6.31 ms）と local storage IPC。
キューが空なら 0 回（control case で確認）。これは「session のデータは local に落とさない」という
storage 設計の前提を恒久ループが破っていることを意味する。

**F. flush 頻度の試算（spec の 3 経路）**: `scheduleCacheSave`（invalidate ごと）、
`headerDetector`（ページビューごと）、`rateLimiter.check()`（`flushImmediately`）。
1 日 300 訪問のヘビーユーザーで各経路 300 回/日、合成上限 900 回/日と置くと、
1.0 ms/flush で **約 0.4〜0.9 秒/日** の純 `estimateStorageSize` コストにしかならない。

**G. quota 予算（`chrome.storage.session` 実形のサイズを実測）**

`QUOTA_BYTES = 10,485,760`（10 MiB、Chrome 112+。Chrome 111 及それ以前は 1 MiB）。
manifest は `unlimitedStorage` を宣言するが、これは **local** に対する権限であり session の 10 MiB は動かない。
`recordingCache` 以外の session キーもすべて同じ 10 MiB を共有する。

| キー | 実測 | JSON MiB |
|---|---|---|
| `privacyCache_<url>` × 2000（`MAX_SESSION_PRIVACY_KEYS`, headerDetector.ts:16） | 448,404 B | 0.428 |
| `sw:tabCache`（40 タブ） | 11,586 B | 0.011 |
| `navTrail`（200 件） | 16,684 B | 0.016 |
| `sw:rateLimiter` / `sw:aiProviderBreaker`（各 40） | 3,936 / 4,302 B | 0.008 |
| `hmacWrappingKey` / `encryptionSecret` / login rateLimit / `swStatePersistence` / confirmToken 等 | 各 27〜300 B | <0.001 |
| **`recordingCache` 以外 合計** | **485,779 B** | **0.463** |

上限を引き上げた場合の合計（Chrome の session 勘定は「値とキーの動的メモリ割り当ての推定」で、
JSON バイト長ではないため、1x（JSON）と 2x（UTF-16 保守上界）の両方を示す）：

| cap | recordingCache 以外 | 1x 合計 | 2x 合計 |
|---|---|---|---|
| 1 MiB | 0.463 MiB | 1.46 MiB (15%) | 2.93 MiB (29%) |
| 2 MiB | 0.463 MiB | 2.46 MiB (25%) | 4.93 MiB (49%) |
| **3 MiB** | 0.463 MiB | **3.46 MiB (35%)** | **6.93 MiB (69%)** |
| 4 MiB | 0.463 MiB | 4.46 MiB (45%) | 8.93 MiB (89%) |
| 5 MiB | 0.463 MiB | 5.46 MiB (55%) | **10.9 MiB → quota 超過** |

**H. spec の「tabCache の remove が無効化される」は反証された**: over-cap 中でも
`chrome.storage.session.remove(['sw:tabCache'])` は着地する（`flush()` の `keysToDelete` 処理は
サイズ分岐の外側: `sessionStore.ts:200-202`）。また reduced flush に `sw:tabCache` は
そのまま含まれる（`extractPriorityData` は `RECORDING_CACHE` キーキーだけ特別扱いする: `sessionStore.ts:255-274`、
実測でも `['sw:recordingCache', 'sw:tabCache']` が書かれた）。被害を受けるのは
`sw:recordingCache` 自身の `urlCache` / `privacyCache` サブキーのみ。

**I. 復元側の影響（spec の「空振り」は限定付き）**: `loadCacheFromSession` は
`saved.urlCache` が無条件だ前提（`recordingCache.ts:256-258`）だが、reduced flush で
`urlCache` が落ちると復元はスキップされる。しかし `UrlCache.get()` は stale で
`getSavedUrlsWithTimestamps()`（`chrome.storage.local` 読み）へフォールバックする
（`UrlCache.ts:19-20`）ので**データ損失はなく、60 秒 TTL のキャッシュミス 1 回**に留まる。
`privacyCache` も同じ（5 分 TTL）で、しかも headerDetector が書く per-URL の
`privacyCache_<url>` セッションキー（`headerDetector.ts:159`）は SessionStore を通らないので残る。
**ユーザーが体感する実害は小さく、実害は D（flush コスト）と E（suspend での local 汚染）にある。**

**J. 既存 pin テストの盲点**: `src/background/__tests__/sessionStore.test.ts:261-279` は
1.2 MiB の単一文字列を 1 回 flush して 1 回目の `set` 呼び出しを検査するだけ。
2 回目以降の再処理もキュー滞留も検証していない（C の実測がその構造を露呈した）。
`recordingCache-session.test.ts:208-226` は size cap を模さない fake store を使っており、
上限検証になっていない（spec の指摘どおり）。

### 実測できなかった項目

- **Chrome 自身が `chrome.storage.session` にどう勘定するか**（`getBytesInUse`、
  「動的メモリ割り当ての推定」の実係数）は Node 環境からは観測できない。
  本 ADR は 1x（JSON バイト）と 2x（UTF-16）の両側で quota を見積もり、
  2x 側で安全側の裁定をしている。実ブラウザでの `getBytesInUse` による確認は
  後続 PBI の受入基準に含める。
- **`privacyCache_` 2000 キーの 0.428 MiB** は実測形の合成値であり、
  実ブラウザのヘッダ文字列長により前後する。これは裁定を左右しない（他キー合計 0.463 MiB に対し
  3 MiB cap の 2x 合計 6.93 MiB は余裕を持つ）。

## 関連するADR
- なし（`dev-docs/ADR/2026-08-12-encryption-secret-storage-area-must-be-local.md` の
  「session に置くべきもの / local に置くべきもの」の線引きが本裁定の前提）

## 決定事項

### 1. 採用：① cap の引き上げ — `SESSION_MAX_FLUSH_BYTES = 3 * 1024 * 1024`（3,145,728 バイト）

- 10,000 件（`MAX_URL_SET_SIZE`）を **293 文字までの URL** で必ず session に書き切れる
  （実測 A/B。83 文字の 1 MiB に対し 3.5 倍の余裕）。
- quota 予算にも余裕がある（実測 G。2x 保守上界でも 6.93 MiB / 10 MiB = 69%、
  4 MiB に上げると 89% となり危険、5 MiB で quota を超える）。
- 名前付き export 定数化し、`1MB` というログ文言（`sessionStore.ts:183`）も実際の値参照に変える。
  値は本 ADR を典拠としてコメントで残す。

### 2. 採用：③ 滞留検知と非優先 drop — 恒久ループを構造的に不可能にする安全網

3 MiB でも 10,000 件 × 320 文字超（実測 A）で超過するため、cap 引き上げだけでは
恒久ループを再発しうる。**「同じキーが N 回連続で overflow 分岐を通ったら writeQueue へ戻さない」**
という上限引入を必須とする。N は 1（1 回で恒久化）でも良いが、
保守的に **連続 2 回**とし、`addLog(LogType.WARN, ...)` で drop したキーと回数を残す。
これで **恒久ループは構造的に存在しなくなる**（N 回で必ずキューから消える）。

### 3. 保留：④ `estimateStorageSize` の per-entry / per-key キャッシュ — 主策にしない

- 実測 D/F より、flush コストは 1.0 ms/flush・0.4〜0.9 秒/日で、**記録ホットパスのボトルネックではない**。
- マイクロベンチでは per-key サイズキャッシュは 1 万件で 1,000 倍以上速い（0.001 ms vs 1.3 ms）だが、
  値は in-place 変更されるため**キャッシュの無効化契約**（set 時に dirty を立てる等）が要る。
  その契約の複雑さは 1.0 ms/flush の節約に対して正当化できない。
- したがって**任意の後続 refactor** とし、flush 頻度を上げた場合（例：per-view 永続化）に再評価する。

### 4. 不採用：② `urlCache` を session から storage へ移動する

- 本裁定の制約「session storage の既存キーの削除は不可」に違反する（キー削除を伴う storage 構造変更）。
- 実測 I により**データの取りこぼしがない**（`UrlCache` は local にフォールバックする）ため、
  緊急性と便益が削除コストに見合わない。
- 別 PBI（storage 構造変更）として起票する。候補は (a) urlCache を local へ移す、(b) 別キー（追加のみ）へ逃がす、(c) session 永続化を urlCache だけやめる、の 3 つ。うち (c) は削除を伴わない。

### キー構造の不変条件（再確認）

- 採用案（① ③ ④）はいずれも**既存キーを削除しない**。cap は `MAX_SESSION_SIZE` の**値**だけを変え、
  ③ は writeQueue の**再キューイング**を止めるだけで session のキー集合には触れない。
- 採用案はいずれも**キー追加も不要**。

## 結果

### メリット
- 1 万件・293 文字以下の URL では session への永続化が恒久的に行われ、実測 C の恒久ループが発生しなくなる。
- suspend 時の 1.427 MiB の `chrome.storage.local` 汚染（実測 E）が起きなくなる。
- flush コストは D のとおり現状でも 1.0 ms で許容範囲であり、④ を入れずに済む。

### デメリット
- session の peak 使用量が 1x で最大 3.46 MiB、2x 保守上界で 6.93 MiB に膨らむ。
  `privacyCache_` が 2000 キーに達したヘビーユーザーでは上限に近づく。
- ③ の drop は「データを捨てる」判断であり、どのキーを捨てるか（`RECORDING_CACHE` の
  `urlCache` / `privacyCache` サブキーが候補）の方針を後続 PBI で明示する必要がある。
- **既存 pin テスト `sessionStore.test.ts:261-279` は 3 MiB cap で壊れる**（1.2 MiB の
  文字列が overflow しなくなるため）。後続 PBI で新しい cap を超える値に差し替える必要がある。

### 影響範囲
- `src/background/sessionStore.ts`（`MAX_SESSION_SIZE` の値と公開化、overflow 分岐の滞留上限、
  ログ文言）。**キーの追加・削除はない。**
- `src/background/__tests__/sessionStore.test.ts`（既存 pin の差し替え + 新規 pin）。
- `recordingCache.ts` / `tabCache.ts` / `rateLimiter.ts` / `headerDetector.ts` は**変更不要**。

### 後続 fix / refactor PBI の起票基準

**fix PBI（主策）**: 「sessionStore の flash バイト上限を 3 MiB に引き上げ、恒久滞留ループを構造的に断つ」
- スコープ: `src/background/sessionStore.ts` + 同ディレクトリ test のみ。
- 受入基準：
  1. `MAX_SESSION_SIZE` が export 済み名前付き定数（値 3,145,728）に置き換わり、コメントに本 ADR を典拠として明記。
  2. 10,000 件 × 180 文字（実測 2,016,058 B）の payload が**縮小されず**そのまま
     `chrome.storage.session.set` に渡る pin。
  3. 新 cap を超える payload では、非優先キーが writeQueue へ**最大 2 回**しか戻されず、
     3 回目以降はキューから drop される（`writeQueue.size === 0`）ことを検査する pin。
  4. drop 時に `addLog(LogType.WARN, ...)` でキー名と連続回数が残ることを検査する pin。
  5. drop されたキーが `emergencyFlushToLocal()` 経由で `chrome.storage.local` に
     書かれないことを検査する pin（実測 E の再発防止）。
  6. 既存 pin `sessionStore.test.ts:261-279` を新 cap 超過値（3.2 MiB 超）へ差し替え、
     かつ「10,000 件 × 180 文字は縮小されない」逆向きの pin を追加する。
  7. `npx vitest run src/background/__tests__/sessionStore.test.ts --repeats=20` が全 green。

**refactor PBI（任意・保留）**: 「`estimateStorageSize` を per-key サイズキャッシュに置換」
- 起票条件: flush 頻度を 1 日 900 回超に上げた場合にのみ起票する。1.0 ms/flush の実測が改善を正当化するまでは起票しない。キャッシュ無効化契約（値の変更で dirty を立てる）を設計書に含むこと。

**別 PBI（storage 構造変更・本裁定の範囲外）**: 「`sw:recordingCache` の `urlCache` 永続化の再設計」
- キー削除を伴うため本裁定では採用しない。候補: (a) urlCache を local へ移す、
  (b) 別キー（追加のみ）へ逃がす、(c) session 永続化をやめて `UrlCache` の local フォールバックに任せる。
- 実測 I により **(c) が最小変更で最大効果**。ただし `loadCacheFromSession`（`recordingCache.ts:256-258`）
  との整合と、既存セッション残存データの移行が要る。

### 未実施（investigate PBI の範囲）
本 PBI は裁定のみ。`src/` / `entrypoints/` / `testDir/` / `eslint/` 配下一切を変更していない。
throwaway 計測スクリプトは `/tmp/pbi12/` に置き、コミットしていない。
spec の DoD が要求する「`dev-docs/plans/` 配下の裁定報告書」は、本 PBI の書き込み許可範囲外だったため
**本 ADR を唯一の裁定記録とする**。

## 参照
- `src/background/sessionStore.ts:181-198,200-202,245-274,317-331`
- `src/background/recordingCache.ts:30-38,242-265,267-278,280-297`
- `src/background/cache/UrlCache.ts:7-24`（`URL_CACHE_TTL = 60_000`、local フォールバック）
- `src/background/cache/PrivacyCache.ts:67-112`
- `src/background/headerDetector.ts:11,16,143-205`（`MAX_SESSION_PRIVACY_KEYS = 2000`）
- `src/background/service-worker.ts:105`（`registerSuspendHandler`）
- `src/background/tabCache.ts:73,90,148,167` / `src/background/rateLimiter.ts:47,59,130`
- `src/utils/urlEntry.ts:9-11` / `src/utils/storage/savedUrlRepository.ts:137-145,258-289`
- `wxt.config.ts:223-225`（`unlimitedStorage` は local のみに効く）
- `src/background/__tests__/sessionStore.test.ts:261-279`（1 回きりの pin）
- `src/background/__tests__/recordingCache-session.test.ts:208-226`（cap を模さない fake store）
- `pbi/2026-09-28-12-investigate-session-store-overflow-persistence.md`
- Chrome storage API: <https://developer.chrome.com/docs/extensions/reference/api/storage>
  （session `QUOTA_BYTES = 10485760`、Chrome 111 及以前は 1 MiB）

## 実機計測の結果（2026-09-28 追記）

Node から観測できなかった `chrome.storage.session.getBytesInUse()` の実係数を、実ブラウザ（Chromium / `dist/chromium-mv3`）の service worker コンソールで計測した。

| 項目 | 実測値 |
|---|---|
| probe payload | 11,692 エントリ / JSON 3,145,731 文字（cap 相当） |
| `set()` の結果 | **成功**（quota エラーなし） |
| 実消費バイト | 4,115,584 B（before 528 → after 4,116,112） |
| 実係数（used / JSON chars） | **1.308** |
| `remove()` 後 | 528 B に復帰 / QUOTA_BYTES 10,485,760 |

判定:

- 実係数 1.308 は 1x（JSON バイト長）想定と 2x（UTF-16 保守上界）の**中間だが 1x 寄り**。UTF-16 の 2.0 は発生しない。
- 1x 見積もり 3.46 MiB（recordingCache 3 MiB + 他キー 0.463 MiB）→ 実際は **≈ 4.5 MiB（quota の 43%）**。
- 2x 保守上界 6.93 MiB は起きないことが実証された。cap 3 MiB の裁定は変更なし（より強く支持される）。
- cap 相当 payload の `set()` がエラーなしで通るため、flush 経路が quota エラーで落ちるケースも実機で否定された。
