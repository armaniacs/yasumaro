# PBI: session store オーバーフロー時の永続化停止の裁定

## ユーザーストーリー

保守者として、保存 URL が 9,000 件を超えた環境でも session 永続化と記録ホットパスの性能が維持される方法を裁定したい。なぜなら 1MB 超過分岐が非優先データを毎回キューへ戻し、永続化が恒久的に止まりつつ毎 flush でフル serialize が走るからだ。

## ビジネス価値

- 保存件数が多いヘビーユーザーで記録が恒久的に非永続化される事象を、実データ推移から予測可能な状態にする。
- 記録のたびに発生する 1MB 超 JSON.stringify と Blob 確保（transient 2-3MB）を、記録ホットパスのコストとして可視化し排除方針を決める。
- 4 つの候補策（cap 引き上げ / urlCache の session 移動 / 滞留 drop / サイズ試算の軽量化）を、実測データと quota 制約に照らして裁定し、後続 fix / refactor の起票基準を作る。
- 「1 回きりの超過」を前提にした既存 pin テストの盲点を明示し、再発を検知できる検証条件として引き継ぐ。

## 優先度

- 種別: investigate
- 順位: 12 / 17
- RICEスコア: 4.8（Reach=3 / Impact=2 / Confidence=80% / Effort=1 SP）

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: 1MB を超える永続化対象に到達した環境で裁定方針が記録される
  Given session に永続化する urlCache の JSON サイズが 1MB を超えている
  And 非優先キーが extractPriorityData で除外され writeQueue へ戻される状態である
  When quota・互換性・性能・複雑さの 4 軸で候補策を評価する
  Then cap 引き上げ・urlCache の session 移動・滞留 drop・試算軽量化の採否が裁定される
  And 採用案と不採用案の双方に理由が記録され、裁定報告書として保存される

Scenario: 恒久的な非永続化ループが 2 回目以降の flush でも続くことを判定できる
  Given 1 回目の flush で 1MB 超過が発生し非優先データが writeQueue へ戻された
  And 次回 flush でも同じキー集合が同じサイズでキューから取り出される
  When 2 回目以降の flush の推定サイズと writeQueue の滞留を観測する
  Then 非優先データが session に永続化されない事象が再現する
  And それが 1 回限りの逸脱ではなく恒久的な状態であることが判定として記録される

Scenario: 採用方針が session storage のキー構造を壊さない
  Given 既存挙動維持の制約として session storage の既存キーの削除と改名が禁止されている
  When 裁定された案をキーの増減の観点で評価する
  Then キー追加を伴う案は既存キーの意味と読み取り側に影響しない
  And キー削除を要する案は採用せず、storage 構造変更として後続 PBI の起票対象として記録される
```

## 受け入れ基準

- [x] 4 つの裁定点（cap の実測ベースへの引き上げ / urlCache の session からの移動 / キュー滞留の検知と非優先 drop / `estimateStorageSize` の per-entry キャッシュまたは軽量化）の採否と理由が裁定されている。
- [x] `chrome.storage.session` の quota（MV3 は 10MB 上限、service worker 全体で共有）が他キーとの取り合いを含めて整理されている。
- [x] 採用案と不採用案のいずれも、session storage の既存キーを削除しない（キー追加は可、削除は不可）ことを確認している。
- [x] urlCache を session から storage へ移す案は storage 構造変更として扱い、キー削除を伴うため本裁定では採用しない前提でリスクが整理されている。
- [x] 10,000 URL 相当の負荷で flush 時のサイズと所要時間を bench/harness で実測し、数値を裁定報告書に残している。
- [x] 裁定内容が ADR として起票できる形にまとめられ、後続 fix / refactor PBI の起票基準が列挙されている。
- [x] 既存 pin テスト（`src/background/__tests__/sessionStore.test.ts:261-279`）が 1 回きりの超過しか覆っていないことと、恒久ループが未検証であることが報告書に記載されている。
- [x] 本 PBI は実装変更を伴わない（sessionStore / recordingCache を含むコードを変更していない）。

## 調査手順

本 PBI は実装を行わない。完了条件は裁定報告書の作成と後続 fix / refactor PBI の起票基準の確定である。テスト戦略セクションは置かず、裁定までに実施する調査手順を以下に列挙する。

1. **現状の制御フロー確認**: `src/background/sessionStore.ts:245` の `MAX_SESSION_SIZE = 1 * 1024 * 1024` と、`:181-198` の超過分岐（`extractPriorityData()` の呼び出しと非優先キーの writeQueue への戻し）を読み、1 回きりの逸脱ではなく次の flush でも同じ状態へ戻る構造を確認する。
2. **コストの実測**: `src/background/sessionStore.ts:247-253` の `estimateStorageSize` は `new Blob([JSON.stringify(value)]).size` でキュー全体を毎回フル serialize する。10,000 URL 相当の値を bench/harness で投入し、flush ごとの transient allocation（1MB 超の JSON 文字列と Blob）と所要時間を計測する。
3. **生産者の同定とflush 頻度の推定**: `src/background/recordingCache.ts:280-297` の `saveCacheToSession()` が urlCache（`MAX_URL_SET_SIZE = 10000`、`src/utils/urlEntry.ts:9`）を 1 session entry に固めて `flushImmediately` することを確認する。呼び出し元は `src/background/recordingCache.ts:267-278` の `scheduleCacheSave`（settings / url / privacy cache の invalidate すべて）、`src/background/headerDetector.ts:152`（ページビューごと）、`src/background/rateLimiter.ts:129-133`（`check()` ごとの `flushImmediately`）の 3 経路である。この頻度が策の複雑さを左右することを定量的に評価する。
4. **失敗シナリオの再現**: 35 日 retention かつ 1 日 300 訪問のヘビーユーザーで保存 URL が 9,000〜10,000 件に到達し、urlCache の JSON が 1.0〜1.1MB になる経路上限を見積もる。以後、非優先キーが恒久的に永続化されないこと、および記録のたびに 1MB 超の serialize が走ることを確認する。
5. **復元側とタブ cache への影響確認**: `src/background/recordingCache.ts:256-258` が `saved.urlCache` を無条件に復元前提としているため、永続化されない場合は空振りになることを明示する。`src/background/tabCache.ts:80-82` も同じ writeQueue を共有しており、remove の即時 flush 意図が超過時に無効化されることを記録する。
6. **候補策の評価**: 裁定点 4 つを quota・互換性・性能・複雑さの 4 軸で比較する。評価条件には、session storage のキー構造を変更しないこと（キー追加は可、削除は不可）を含める。
7. **裁定の記録**: 採否・理由・前提・不採用案の不採用理由を `dev-docs/plans/` 配下の裁定報告書にまとめ、ADR の起票可否と後続 fix / refactor PBI の起票基準を列挙する。

## 裁定結果（2026-09-28 記入）

裁定の全文と実測データは ADR に記録した:
`dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md`
（spec の DoD が要求する `dev-docs/plans/` 配下の裁定報告書は、本 PBI の書き込み許可範囲外だったため、
本 ADR を唯一の裁定記録とする。）

### 4 つの裁定点の採否

| 案 | 採否 | 理由 |
|---|---|---|
| ① cap の引き上げ | **採用**（`3 * 1024 * 1024` = 3,145,728 バイト） | 10,000 件を 293 文字までの URL で必ず書き切れる（実測）。session quota 10 MiB のうち 2x 保守上界でも 6.93 MiB（69%）に収まり、4 MiB に上げると 89%、5 MiB で超過。 |
| ② urlCache の session からの移動 | **不採用** | キー削除を伴う storage 構造変更で本裁定の制約違反。かつ実測で `urlCache` は local へフォールバックするため取りこぼしがなく、削除コストに見合わない。別 PBI へ送る。 |
| ③ キュー滞留の検知と非優先 drop | **採用**（安全網） | 3 MiB でも 10,000 件 × 320 文字超で超過しうるため、cap 引き上げだけでは恒久ループが再発しうる。「連続 N 回 overflow したら再キューイングしない」で恒久ループを構造的に不可能にする。 |
| ④ `estimateStorageSize` の per-entry / per-key キャッシュ | **保留**（主策にしない） | 実測で 1.00〜1.04 ms/flush、900 flush/日でも 0.4〜0.9 秒/日でボトルネックではない。キャッシュ無効化契約の複雑さが 1 ms の節約に見合わない。任意の後続 refactor。 |

採用案はいずれも session storage の既存キーを削除せず、キー追加も不要。

### 実測で判明した spec の前提の誤り

- `PersistedCacheState.urlCache` の要素は `[url, timestamp]` であり（`recordingCache.ts:34`）、
  `SavedUrlEntry` 全体ではない（`savedUrlRepository.ts:137-145`、`UrlCache.ts:10`）。
- 10,000 件での実直列化サイズは **0.664〜1.923 MiB**（URL 長依存、1 件あたり `urlBytes + 21.6` バイト）。
  spec の「1.0〜1.1 MiB」は URL が 84〜100 文字のときにだけ成立する。
- 上限 1 MiB は 132 文字なら 6,898 件、180 文字なら 5,201 件で超える（10,000 件より前）。
- spec の「tabCache の remove が即時 flush 無効化される」は**反証**された。`flush()` の `keysToDelete`
  処理はサイズ分岐の外側（`sessionStore.ts:200-202`）なので remove は着地し、reduced flush にも
  `sw:tabCache` はそのまま含まれる。
- spec の「復元側は空振り」は限定付き。`UrlCache.get()` が `chrome.storage.local` へフォールバック
  （`UrlCache.ts:19-20`）するため**データ損失はなく**、60 秒 TTL のキャッシュミス 1 回に留まる。
- 実害の実体は (a) 1.00〜1.04 ms/flush と 672 KiB/flush の transient メモリ、
  (b) 恒久滞留した writeQueue が SW suspend ごとに `emergencyFlushToLocal()` を通り
  **1.427 MiB の `sw:recordingCache` を `chrome.storage.local` に書き出す**こと（`service-worker.ts:105`）。

### 既存 pin テストの盲点

`src/background/__tests__/sessionStore.test.ts:261-279` は 1.2 MiB の単一文字列を 1 回 flush して
1 回目の `set` 呼び出しを検査するだけ。実測では 10 回 flush 連続で毎回 1 回 `set` が呼ばれ
（毎回 2,715 バイト）、`writeQueue` に 1 キーが残り続けた。2 回目以降の再処理もキュー滞留も
検証していない。`recordingCache-session.test.ts:208-226` は size cap を模さない fake store である。

なお 1.2 MiB という pin の値は裁定した 3 MiB cap の下にあり、後続 fix PBI では
この pin を新 cap 超過値へ差し替える必要がある（さもないとテストが壊れる）。

### 実測できなかった項目

Chrome 自身が `chrome.storage.session` をどう勘定するか（`getBytesInUse`、「動的メモリ割り当ての推定」の
実係数）は Node 環境からは観測できない。裁定は 1x（JSON バイト）と 2x（UTF-16）の両側で
quota を見積もり、2x 側で安全側に倒している。実ブラウザでの `getBytesInUse` 確認は後続 PBI の
受入基準に含める。

### 後続 fix / refactor PBI の起票基準

1. **fix PBI（主策）**: 「sessionStore の flush バイト上限を 3 MiB に引き上げ、恒久滞留ループを構造的に断つ」
   - スコープは `src/background/sessionStore.ts` + 同ディレクトリ test のみ。キーの追加・削除はしない。
   - 受入基準は ADR「後続 fix / refactor PBI の起票基準」節の 7 項目（既存 pin の差し替え、
     10,000 件 × 180 文字が縮小されない pin、連続 2 回で drop される pin、
     drop されたキーが `chrome.storage.local` に書かれない pin、`--repeats=20` green）。
2. **refactor PBI（任意・保留）**: 「`estimateStorageSize` を per-key サイズキャッシュに置換」。
   flush 頻度を 1 日 900 回超に上げた場合にのみ起票する。
3. **storage 構造変更 PBI（本裁定の範囲外）**: 「`sw:recordingCache` の `urlCache` 永続化の再設計」。
   候補は (a) local へ移す、(b) 別キーへ逃がす、(c) session 永続化をやめて local フォールバックに任せる。
   実測より (c) が最小変更で最大効果。

## 実装アプローチ

本 PBI は調査のみであり実装は行わない。

- **Outside-In**: まず「保存 URL が 9,000 件で記録が恒久的に非永続化される」という外部観測点（bench/harness での flush 観測）を確認し、その後に策を評価する。
- **実測優先**: cap の値は理論値ではなく 10,000 URL 実測のサイズを基準に判断する。`estimateStorageSize` のコストが flush 頻度を乗じて記録のたびに発生している点を、評価軸として必ず計上する。
- **互換性優先**: キー削除を伴う案（urlCache の storage 移動）は storage 構造変更として切り出し、本裁定では採用しない前提でリスクだけを整理する。
- **裁定の可追従性**: 採用と不採用の双方に理由を残し、後続 PBI が同じ調査をやり直さないようにする。

## 見積もり

**1 SP**

実測 1 件（10,000 URL 相当の flush サイズと所要時間）、4 ファイル（`src/background/sessionStore.ts`、`src/background/recordingCache.ts`、`src/background/tabCache.ts`、`src/background/rateLimiter.ts`）と既存 pin テスト 2 ファイルの読解、4 案の比較評価、裁定報告書の作成が主体である。コード変更とテスト追加は含まない。

## 技術的考慮事項

- `src/background/sessionStore.ts:245` の `MAX_SESSION_SIZE = 1 * 1024 * 1024` は 1MB 固定であり、実測サイズに基づく値ではない。
- `src/background/sessionStore.ts:181-198` は超過時に `extractPriorityData()` で優先データのみを書き、非優先キーは `:191-195` で writeQueue へ戻す。戻されたキーは次回 flush でもキューから取り出され、超過状態が継続する。
- `src/background/sessionStore.ts:255-274` の `extractPriorityData()` は recordingCache キーの `settingsCache` / `cacheTimestamp` / `cacheVersion` のみを残す。urlCache は優先データに含まれない。
- `src/background/sessionStore.ts:247-253` の `estimateStorageSize` は `new Blob([JSON.stringify(value)]).size` で、キュー全体を毎回フル serialize する。超過状態の継続中は、このコストが flush ごとに発生する。
- `src/background/recordingCache.ts:280-297` の `saveCacheToSession()` は urlCache（`MAX_URL_SET_SIZE = 10000`、`src/utils/urlEntry.ts:9`）を 1 session entry に固めて `flushImmediately` する。
- 生産者は 3 経路: `src/background/recordingCache.ts:267-278` の `scheduleCacheSave`（settings / url / privacy cache の invalidate すべて）、`src/background/headerDetector.ts:152`（ページビューごと）、`src/background/rateLimiter.ts:129-133`（`check()` ごとの `flushImmediately`）。flush 頻度は策の複雑さを左右する。
- 復元側は `src/background/recordingCache.ts:256-258` が `saved.urlCache` を無条件に復元前提とするため、永続化されない場合は空振りになる。
- `src/background/tabCache.ts:80-82` の remove 時 flush は同じ writeQueue を共有するため、超過時に即時 flush の意図が実質的に無効化される。
- 35 日 retention かつ 1 日 300 訪問で保存 URL は 3 週間相当に到達し、9,000〜10,000 件で urlCache JSON が 1.0〜1.1MB になる。以後、非優先非永続化と記録ごとの 1MB 超 serialize（transient 2-3MB）が恒久化する。
- `src/background/__tests__/sessionStore.test.ts:261-279` は 1 回きりの超過のみを pin している。2 回目以降の再処理と恒久ループは未検証である。
- `src/background/__tests__/recordingCache-session.test.ts:208-226` は size cap を模さない fake store を使っており、実質的な上限検証になっていない。
- `chrome.storage.session` の quota は環境差があり、MV3 は 10MB 上限だが service worker 全体で共有される。cap の引き上げは他キーとの取り合いを生む。
- 裁定は ADR 化し、cap 値・drop 方針・キー構造制約の判断理由を残すべきである。

## 実装者向け注記

### 現状コードの確認

- `src/background/sessionStore.ts:245` は 1MB 固定の cap。`:181-198` が超過分岐、`:247-253` が毎回フル serialize する試算、`:255-274` が優先データ抽出である。
- `src/background/recordingCache.ts:280-297` の `saveCacheToSession()` が単一の巨大 session entry を作る。呼び出し元は `src/background/recordingCache.ts:267-278`、`src/background/headerDetector.ts:152`、`src/background/rateLimiter.ts:129-133` の 3 経路。
- `src/background/recordingCache.ts:256-258` は `saved.urlCache` を無条件に復元する前提になっているため、復元不可能な状態は空振りになる。
- `src/background/tabCache.ts:80-82` は同じ writeQueue を共有しており、remove の即時 flush 意図が超過時に失われる。
- `src/background/__tests__/sessionStore.test.ts:261-279` は 1 回きりの超過のみ。`src/background/__tests__/recordingCache-session.test.ts:208-226` は size cap を模さない fake store である。
- 裁定報告書と ADR は本 PBI の成果物であり、コード変更は発生しない。

### 実装手順

1. `src/background/sessionStore.ts:181-198,245-274` を読んで、超過が恒久状態になる制御フローを確認する。
2. bench/harness で 10,000 URL 相当のキューを構築し、1 flush あたりの `estimateStorageSize` の所要時間と transient allocation を実測する。
3. flush 頻度を `src/background/recordingCache.ts:267-278`、`src/background/headerDetector.ts:152`、`src/background/rateLimiter.ts:129-133` の 3 経路から推定し、策の複雑さへの影響を評価軸に加える。
4. 35 日 retention かつ 1 日 300 訪問で保存 URL が 9,000〜10,000 件に到達し urlCache JSON が 1.0〜1.1MB になる上限を確定する。超過後の 2 回目以降の flush でも非優先が永続化されないことを確認する。
5. 4 つの裁定点（cap 引き上げ / urlCache の session 移動 / 滞留 drop / 試算軽量化）を、セッションキーの不変制約（キー追加可・削除不可）と quota の取り合いを含めて比較する。
6. 採否と理由を `dev-docs/plans/` 配下の裁定報告書にまとめ、ADR の起稿可否と後続 fix / refactor PBI の起票基準を列挙する。

### 落とし穴

- `chrome.storage.session` の quota は環境差がある。MV3 は 10MB 上限だが service worker 全体で共有されるため、cap を単純に上げると他キーの永続化を圧迫する。
- `src/background/rateLimiter.ts:129-133` の `check()` ごとの `flushImmediately` 頻度が高いと、策①〜④の複雑さが大きく変わる。flush 頻度を測らずに cap だけを考えると誤った裁定になる。
- 1 回きりの超過を 1 回きりの事象として扱うと、恒久ループを見落とす。2 回目以降の flush まで観測する。
- urlCache を session から storage へ移す案は storage 構造変更を伴う。キー削除は本裁定の制約で禁止されているため、切り出して別 PBI へ送る。
- `estimateStorageSize` のコストを試算コストとして評価しないと、「cap を上げる」だけでは記録ホットパスの負荷が残ることを見落とす。
- 裁定を口頭の合意で済ませると、後続 PBI が同じ調査をやり直す。判断理由と前提を ADR として残す。
- 既存の pin テスト（`src/background/__tests__/sessionStore.test.ts:261-279`）を本裁定で変更すると 1 回きりの上限保証を失う。テスト改修は裁定後の fix PBI のスコープである。

## 決定事項

1. 記録の恒久的な非永続化が発生する理由は、1MB 超過時に非優先キーが writeQueue へ戻され、次回 flush でも同じキー集合が同じサイズで超過するためである。1 回きりの逸脱ではない。
2. 超過状態の継続中に記録コストが積み上がる理由は、`estimateStorageSize` が `new Blob([JSON.stringify(value)]).size` でキュー全体を毎回フル serialize するためである。
3. ヘビーユーザーで顕在化する理由は、35 日 retention かつ 1 日 300 訪問で保存 URL が 9,000〜10,000 件に到達し、urlCache JSON が 1.0〜1.1MB になるためである。
4. 既存テストで検出されなかった理由は、`src/background/__tests__/sessionStore.test.ts:261-279` が 1 回きりの超過のみを pin し、`src/background/__tests__/recordingCache-session.test.ts:208-226` が size cap を模さない fake store を使っているためである。
5. 本 PBI は裁定のみで実装を行わない。完了条件は裁定報告書の作成と後続 fix / refactor PBI の起票基準の確定である。
6. 裁定は 4 つの裁定点（cap 引き上げ / urlCache の session 移動 / 滞留 drop / 試算軽量化）の採否を quota・互換性・性能・複雑さの 4 軸で記録する。
7. 採用案の評価は session storage のキー構造を維持する前提で行う（キー追加は可、削除は不可）。
8. urlCache を session から storage へ移す案はキー削除を要するため、本裁定では採用せず、storage 構造変更として別 PBI へ送る。
9. 裁定内容は ADR として起票し、後続 PBI は当該 ADR の前提条件として実装する。

## Definition of Done

- [x] 4 つの裁定点の採否と理由が裁定記録にまとめられている。
- [x] 採用案と不採用案の双方に理由が記載され、不採用案の根拠が明示されている。
- [x] `chrome.storage.session` の quota と他キーとの取り合いが整理されている。
- [x] 10,000 URL 相当での flush サイズと所要時間が bench/harness で実測され、数値が記録に残っている。
- [x] 2 回目以降の flush における恒久ループが再現・確認され、報告書に記録されている。
- [x] session storage のキー構造を壊さない（キー追加は可、削除は不可）ことが評価条件として明記されている。
- [x] urlCache の session からの移動が storage 構造変更として別 PBI へ送られる旨が記録されている。
- [x] 裁定報告書が `dev-docs/plans/` 配下に作成され、ADR の起票可否が判断されている。
      （未達: 本 PBI の書き込み許可範囲は `dev-docs/ADR/2026-09-28-*.md` と本ファイルのみだったため、
      裁定報告書は `dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md` として作成した。
      ADR の起票可否は「可」と判断済み。integrator が本 PBI を close する際に、
      裁定報告書を `dev-docs/plans/` へ転記するか、ADR 単一記録で可とするかを確定すること。）
- [x] 後続 fix / refactor PBI の起票基準が列挙されている。
- [x] 本 PBI でコード変更（sessionStore / recordingCache を含む）が発生していない。
- [x] BDD 受け入れシナリオの検証が完了している。
