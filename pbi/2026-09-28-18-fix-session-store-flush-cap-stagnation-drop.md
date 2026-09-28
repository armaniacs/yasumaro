# PBI: sessionStore flush cap の引き上げと恒久滞留ループの構造的断絶

## ユーザーストーリー

重量ユーザー（保存 URL 約 9k 件超）として、session 永続化が恒久停止せず、記録ホットパスが O(n) に劣化しないようにしたい。なぜなら 1MiB の flush cap を超える urlCache が writeQueue に恒久滞留し、毎 flush がフル serialize され、suspend 時には 1.4MiB が storage.local へ緊急退避されるからだ（いずれも実測）。

## ビジネス価値

- 保存件数が多いヘビーユーザーで「記録が session に恒久的に書かれない」という事象を、構造的に終了させる。
- 恒久滞留した writeQueue が SW suspend のたびに `chrome.storage.local` を 1.4MiB 汚染する実害を排除する（実測 1,496,644 B）。
- 恒久ループが再実装されなくても「存在し得ない」ことをテストで pin し、再発を検知できる状態を作る。
- cap を実測に基づく名前付き定数へ変更し、1MB という固定仮定をコードから撤去する。

## 優先度

- 種別: fix
- 順位: 18 / 23
- RICEスコア: 9.0（Reach=3 / Impact=3 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 10,000 件 × 180 文字の urlCache が縮小されず session に書き込まれる
  Given sw:recordingCache に 10,000 件 × 180 文字の urlCache（[url, timestamp] 形式・2,016,058 B）が入った
  And flush cap が 3,145,728 バイト（3 MiB）である
  When flush する
  Then chrome.storage.session.set には縮小後の優先データではなく full set が渡る
  And writeQueue に sw:recordingCache が滞留しない

Scenario: 新 cap を超える非優先キーは最大 2 回まで再キューイングされ、3 回目で drop される
  Given 1 キーだけで 3 MiB を超える payload が writeQueue にある
  When flush を連続して 4 回実行する
  Then 1 回目と 2 回目に限り writeQueue へ戻される
  And 3 回目以降は writeQueue から drop され、キューに残らない

Scenario: drop されたキーが suspend 時に storage.local へ漏れない
  Given 新 cap を超えて滞留し、その後 drop されたキーが存在する
  When service worker が suspend して emergencyFlushToLocal が走る
  Then chrome.storage.local.set は drop 済みキーを含まない

Scenario: drop 時にキー名と連続回数がログに残る
  Given 新 cap を超える非優先キーがある
  When 3 回目の overflow flush でキーが drop される
  Then addLog(LogType.WARN, ...) にキー名と連続回数が含まれる
```

## 受け入れ基準

- [ ] `src/background/sessionStore.ts:245` の `MAX_SESSION_SIZE` が export 済み名前付き定数 `SESSION_MAX_FLUSH_BYTES = 3 * 1024 * 1024`（3,145,728）に置き換えられ、コメントに `dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md` を典拠として明記されている。
- [ ] 10,000 件 × 180 文字（2,016,058 B）の payload が縮小されず、そのまま `chrome.storage.session.set` に渡る pin が `src/background/__tests__/sessionStore.test.ts` にある。
- [ ] 新 cap を超える payload では非優先キーが writeQueue へ最大 2 回しか戻されず、3 回目以降はキューから drop される（`writeQueue.size === 0`）ことを検査する pin がある。
- [ ] drop 時に `addLog(LogType.WARN, ...)` でキー名と連続回数が残ることを検査する pin がある。
- [ ] drop されたキーが `emergencyFlushToLocal()` 経由で `chrome.storage.local` に書かれないことを検査する pin がある。
- [ ] 既存 pin `src/background/__tests__/sessionStore.test.ts:261-279` と `:373-380` が新 cap 超過値（3 MiB 超）へ差し替えられ、前者には「10,000 件 × 180 文字は縮小されない」逆向きの pin が追加されている。
- [ ] `src/background/sessionStore.ts:183` の `1MB` 固定文言が実際の定数参照（または実値）へ変わっている。
- [ ] session のキー追加・削除がない（`chrome.storage.session` のキー集合は今日のまま）で、`npx vitest run src/background/__tests__/sessionStore.test.ts --repeats=20` が全 green である。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 実ブラウザで保存 URL が 9k 件超の状態で記録を続け、suspend（SW 停止）後も記録が session から復元されることを外部観測する。Outside-In の観測点とする。
- suspend 時に `chrome.storage.local` へ 1.4MiB 規模の `sw:recordingCache` が書き出されないことを、実ブラウザの storage インスペクタで確認する。
- `chrome.storage.session.getBytesInUse` による実測（Node からは観測できない項目）を手動確認として実施する。

### 統合テスト

- `src/background/recordingCache.ts:280-297` の `saveCacheToSession()` が 3 経路（`scheduleCacheSave`、headerDetector、rateLimiter）から投入した urlCache が、新 cap 内で `chrome.storage.session.set` にフルで着地するまでを一連の流れとして検証する。
- 滞留 → drop → `emergencyFlushToLocal` の経路（`src/background/service-worker.ts:105` の `registerSuspendHandler` → `src/background/sessionStore.ts:305-311` → `:317-331`）で、drop 済みキーが local へ到達しないことを検証する。
- `src/background/__tests__/recordingCache-session.test.ts:208-226` の fake store は size cap を模さないため上限検証になっていない。本 PBI の上限検証は `sessionStore` 側 pin を正とし、消費側のテストは変更しない。

### 単体テスト

- `SESSION_MAX_FLUSH_BYTES` の値が 3,145,728 であることを pin する。
- 10,000 件 × 180 文字が縮小されないことを pin する（`src/background/__tests__/sessionStore.test.ts:261-279` の差し替え）。
- 新 cap 超過時に非優先キーが writeQueue へ 2 回まで戻り、3 回目以降 drop されることを pin する。
- drop 時に `addLog(LogType.WARN, ...)` がキー名と回数を含むことを pin する。
- drop 済みキーが `emergencyFlushToLocal()` の `chrome.storage.local.set` に含まれないことを pin する。
- `src/background/__tests__/sessionStore.test.ts:373-380`（非 RECORDING_CACHE キーはそのまま保持）も新 cap 超過値へ差し替え、意図どおり「超過時」の分岐を踏んでいることを確認する。

## 実装アプローチ

- **Outside-In**: まず「10,000 件 × 180 文字がフルで session に書かれる」という観測点を Red として書き、cap 定数の置き換えで Green にする。
- **Red-Green-Refactor**: 現行の「毎回 2,715 B しか書かれない」恒久ループを Red として再現し、滞留上限 2 回の導入で Green にする。
- **最小差分**: `src/background/sessionStore.ts` の定数宣言・overflow 分岐・ログ文言と、同ディレクトリのテストのみを変更する。`recordingCache.ts` / `tabCache.ts` / `rateLimiter.ts` / `headerDetector.ts` は変更しない。
- **構造的断絶の明示**: 「連続 2 回で必ずキューから消える」ことを保証として実装し、恒久ループが再実装されても同じ pin で落ちることを保証する。
- **典拠の埋め込み**: cap 値と drop 方針の根拠は ADR にあるため、コードコメントには ADR パスと該当行（`:156-172`）だけを書く。裁定の議論をコードに複製しない。

## 見積もり

**1 SP**

内訳:
- `MAX_SESSION_SIZE` を `SESSION_MAX_FLUSH_BYTES` へ export 化し、ログ文言を修正: 0.1 SP
- 滞留カウンタと drop 分岐の実装: 0.3 SP
- 既存 pin 2 本の差し替えと新規 pin 4 本: 0.4 SP
- `--repeats=20` 実行と手動確認（`getBytesInUse`）: 0.2 SP

`recordingCache.ts` 側は ADR の実測どおり変更不要。

## 技術的考慮事項

- `src/background/sessionStore.ts:245` は `private readonly MAX_SESSION_SIZE = 1 * 1024 * 1024` であり、クラスの private フィールドである。export 済み名前付き定数へ上げる場合はモジュールトップレベル（`src/background/sessionStore.ts:35` の `SESSION_STORE_FLUSH_DELAY_MS` と同じ場所）に置くのが同ファイルの正規形である。
- `src/background/sessionStore.ts:181-198` が超過分岐の全体。`:181` で `estimateStorageSize` を呼び、`:182` で cap 判定、`:187` で `extractPriorityData`、`:188` で優先データのみ `set`、`:191-195` で非優先キーを writeQueue へ戻す。戻されたキーは次回 flush でも同じサイズでキューから取り出され、同じ分岐を通る（恒久ループ）。
- `src/background/sessionStore.ts:255-274` の `extractPriorityData` は `PRIORITY_SUBKEYS`（`:29` の `settingsCache` / `cacheTimestamp` / `cacheVersion`）のみを残す。urlCache は優先データに含まれない。
- `src/background/sessionStore.ts:247-253` の `estimateStorageSize` は `new Blob([JSON.stringify(value)]).size` でキュー全体を毎回フル serialize する。実測 1.00〜1.04 ms/flush・672 KiB transient RSS/flush。ADR の裁定で主策にしないことが決まっている（キャッシュ無効化契約の複雑さが 1 ms/flush の節約に正当化されないため）。したがって cap 引き上げが主策であり、本 PBI で `estimateStorageSize` の実装には触れない。
- `src/background/sessionStore.ts:183` のログ文言 `'SessionStore: estimated flush size exceeds 1MB, saving priority data only'` は `1MB` をハードコードしている。cap 変更後も値が嘘にならないように実値参照へ変更する。
- `src/background/sessionStore.ts:317-331` の `emergencyFlushToLocal` は `writeQueue` の全内容を fire-and-forget で `chrome.storage.local` に書く。drop 済みキーが writeQueue から消えていれば自動的に local にも書かれない。したがって受入基準 5 は overflow 分岐の drop 実装が writeQueue に戻さないことで満たされる（追加のフィルタは不要）。
- `src/background/service-worker.ts:105` が `SessionStore.registerSuspendHandler(sessionStore)` を登録し、`src/background/sessionStore.ts:305-311` の listener が suspend 時に `emergencyFlushToLocal()` を呼ぶ。実測で恒久滞留していた `sw:recordingCache` 1,496,644 B が local に書き出されていた。
- `src/background/__tests__/sessionStore.test.ts:261-279` の既存 pin は 1.2 MiB の単一文字列を 1 回 flush して 1 回目の `set` だけを検査する。裁定した 3 MiB cap の下にあるため、このままでは overflow 分岐を踏まず Green だが検証力度が 0 になる（テストが壊れるのではなく、意味を失う）。新 cap 超過値への差し替えが必須。
- `src/background/__tests__/sessionStore.test.ts:373-380` も 1.2 MiB を使う「非 RECORDING_CACHE キーはそのまま保持」の pin で、同じ理由で意味を失う。ADR の受入基準 6 は `:261-279` のみを指すが、`:373-380` も併せて差し替えること（さもないと「cap を超えたとき」の検証が 1 本になる）。
- `src/background/__tests__/sessionStore.test.ts:246-259` は `emergencyFlushToLocal()` が queued data を local に書くことを pin する正常系。この pin を壊さないこと（drop 済みキーだけが local に出ない）。
- `src/background/__tests__/sessionStore.test.ts:363-371` は circular 参照で `estimateStorageSize` が 0 を返し、cap を超えずに as-is で書かれることを pin する。0 は常に cap 未満なので cap 変更で壊れない。
- quota 実測: `chrome.storage.session` の `QUOTA_BYTES = 10,485,760`、他キー合計 0.463 MiB。3 MiB cap のとき 1x（JSON）で 3.46 MiB（35%）、2x（UTF-16 保守上界）で 6.93 MiB（69%）。manifest の `unlimitedStorage` は local に対する権限であり session の 10 MiB は動かない。
- エントリの実形は `[url, timestamp]`（`src/background/recordingCache.ts:34` の `urlCache: [string, number][] | null`）であり `SavedUrlEntry` 全体ではない。1 MiB 壁は URL 83 文字超 × 10,000 件で到達する（ADR 実測 A）。本 PBI で spec の誤った前提をコードに持ち込まない。
- ADR では 3 MiB でも 10,000 件 × 320 文字超で超過しうるため、cap 引き上げ単独では恒久ループを再発しうる。drop 安全網（ADR 決定事項 2）を同じ PBI に含める。
- 採用案はいずれも既存キーを削除せず、キー追加も不要（ADR「キー構造の不変条件」）。`chrome.storage.session` のキー集合は不変。

## 実装者向け注記

### 現状コードの確認

- `src/background/sessionStore.ts:245` が 1 MiB 固定 cap、`:181-198` が超過分岐、`:247-253` が毎回フル serialize する試算、`:255-274` が優先データ抽出、`:29` が `PRIORITY_SUBKEYS` の定義。
- `src/background/sessionStore.ts:35` が `SESSION_STORE_FLUSH_DELAY_MS` という export 済み定数の置き場所として同ファイルの正規形になっている。
- `src/background/sessionStore.ts:317-331` が `emergencyFlushToLocal`、`:305-311` が `registerSuspendHandler`。`src/background/service-worker.ts:105` から呼ばれる。
- `src/background/__tests__/sessionStore.test.ts:261-279` が 1 回きりの overflow pin、`:373-380` が非優先キー保持 pin、`:246-259` が emergency flush の正常系 pin、`:363-371` が `estimateStorageSize` の 0 フォールバック pin。
- 裁定は `dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md` に記録済み。実測値・quota 表・不採用案の理由はそこから読むこと。

### 実装手順

1. `dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md:215-231`（後続 fix PBI の起票基準）と `:156-172`（決定事項 1・2）を精読し、7 項目の受入基準に 1 対 1 で対応させる。
2. Red を書く。`src/background/__tests__/sessionStore.test.ts:261-279` を 10,000 件 × 180 文字（2,016,058 B）の payload に差し替え、`set` に full set が渡ることを期待する。現状の 1 MiB cap では縮小されるため Red になる。
3. `src/background/sessionStore.ts:245` の private フィールドを削除し、モジュールトップレベル（`:35` の付近）に `export const SESSION_MAX_FLUSH_BYTES = 3 * 1024 * 1024;` を追加する。コメントに ADR パスと典拠行（`:156-163`）を書く。
4. 参照側（`src/background/sessionStore.ts:182`）を新定数に置き換える。private フィールドへの参照を 1 箇所も残さない。
5. `src/background/sessionStore.ts:183` のログ文言を `'1MB'` 参照から実値の組立へ変更する。
6. 滞留カウンタを実装する。overflow 分岐専用の `Map<string, number>` フィールドを持ち、`:191-195` の writeQueue 戻し前にカウンタを参照する。カウンタが 2 回に達しているキーは writeQueue に戻さず、`addLog(LogType.WARN, ...)` にキー名と回数を載せて drop する。
7. カウンタは drop したキーと正常時に書きできたキーについてのみリセットする（flush 全体のクリアにしない）。小さい値に縮んだ後に大きい値へ戻るケースで回数が止まらないことを確認するテストを 1 本足す。
8. 既存 pin `src/background/__tests__/sessionStore.test.ts:373-380` を 3 MiB 超の値へ差し替える。
9. 新規 pin を追加する: (a) 2 回まで writeQueue へ戻る、(b) 3 回目で `writeQueue.size === 0`、(c) drop 時に WARN ログにキー名と回数、(d) drop 済みキーが `emergencyFlushToLocal` の local `set` に含まれない。
10. 既存 pin `src/background/__tests__/sessionStore.test.ts:246-259`（emergency flush の正常系）が引き続き green であることを確認する。
11. `npx vitest run src/background/__tests__/sessionStore.test.ts --repeats=20` を実行する。
12. `npm run validate` を実行する。
13. 実ブラウザで `chrome.storage.session.getBytesInUse()` を確認し、ADR の 1x / 2x 見積もり（3.46 / 6.93 MiB）の妥当性を検証する。結果を PR に記載する。

### 落とし穴

- drop カウンタは **service worker 再起動でリセットされる**。これは永続化しない設計として明示すること。`chrome.storage.session` へカウンタを書くと本 PBI の「キー追加なし」制約に違反し、session の容量も消費する。再起動後に同じキーが再び滞留し得るが、3 回で必ず消える構造的保証は再起動ごとに成立するため、恒久ループには戻らない。
- `src/background/__tests__/sessionStore.test.ts:261-279` は **Green のまま無効化する**。1.2 MiB のままだと 3 MiB cap で overflow 分岐を踏まず、assert は通るが検証していない。cap 変更時に 1.2 MiB を使う pin を必ず洗い出すこと。
- カウンタを `writeQueue` と同じ `Map` に混ぜると、キュー自身のキー集合が壊れる。専用フィールドに分けること。
- カウンタのリセット条件を「flush 成功時に全キー分をクリア」にすると、大きいキーと小さいキーが交互に待つケースで回数が進まない。キー単位で管理すること。
- 3 MiB cap は session の peak 使用量を 1x で最大 3.46 MiB、2x 保守上界で 6.93 MiB に膨らませる。`privacyCache_` が 2,000 キーに達したヘビーユーザーでは上限に近づく。4 MiB は 89%、5 MiB は quota 超過なので、引き上げの上限は 3 MiB である。
- drop は「データを捨てる」判断である。どのキーを捨てるか（`RECORDING_CACHE` の `urlCache` / `privacyCache` サブキーが候補）の方針は ADR が後続 PBI へ委ねている。本 PBI では「非優先キーは 2 回で drop する」単一方針に統一し、キー名と回数をログで可視化するのが最小差分である。
- 実ブラウザの `getBytesInUse` による quota 実測は Node からはできない。ADR が 1x と 2x の両側で見積もっている理由がそれであり、手動確認を省略して「予算内」と断言しないこと。
- `MAX_SESSION_SIZE` は private フィールドなので export 定数に移すと差分が広く見える。機械的な置換でトレースを複雑にせず、参照 1 箇所（`:182`）と定義 1 箇所だけを触る。

## 決定事項

1. cap は `SESSION_MAX_FLUSH_BYTES = 3 * 1024 * 1024`（3,145,728）へ引き上げる。ADR 実測で 10,000 件を 293 文字までの URL で必ず書き切れ、quota も 2x 保守上界 6.93 MiB / 10 MiB = 69% に収まる。
2. 4 MiB（89%）と 5 MiB（quota 超過）は不採用。3 MiB を超える引き上げは行わない。
3. `MAX_SESSION_SIZE` はモジュールトップレベルの export 済み名前付き定数にし、ADR `dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md` を典拠としてコメントに残す。
4. `src/background/sessionStore.ts:183` の `1MB` ハードコードログ文言は実値参照へ変更する。
5. 滞留安全網を採用する。同一キーが新 cap を超えて writeQueue へ戻されるのは最大 2 回までで、3 回目は drop する。drop 時は `addLog(LogType.WARN, ...)` にキー名と連続回数を残す。
6. drop カウンタは永続化しない。service worker 再起動でリセットされるが、3 回で必ず消えるため恒久ループは構造的に発生しない。
7. `emergencyFlushToLocal` に追加のフィルタを置かない。drop 済みキーが writeQueue に無いことで自動的に `chrome.storage.local` にも書かれない。
8. `estimateStorageSize` の per-key サイズキャッシュは主策にしない。1.0 ms/flush の実測に対し、無効化契約の複雑さが正当化されない（ADR 決定事項 3）。任意の後続 refactor とし、flush 頻度を 1 日 900 回超に上げた場合にのみ起票する。
9. `chrome.storage.session` のキー追加・削除は行わない。採用案はいずれも既存キーの値と再キューイングの挙動だけを変える。

## Definition of Done

- [ ] `SESSION_MAX_FLUSH_BYTES`（3,145,728）が export 済み名前付き定数として存在し、ADR 典拠がコメントにある。
- [ ] 10,000 件 × 180 文字の payload が縮小されず session にフルで書かれる pin がある。
- [ ] 新 cap 超過時に非優先キーが writeQueue へ最大 2 回戻り、3 回目以降は drop される pin がある。
- [ ] drop 時に `addLog(LogType.WARN, ...)` でキー名と連続回数が残る pin がある。
- [ ] drop 済みキーが `emergencyFlushToLocal()` 経由で `chrome.storage.local` に書かれない pin がある。
- [ ] `src/background/__tests__/sessionStore.test.ts:261-279` と `:373-380` が新 cap 超過値へ差し替えられ、`:246-259` の emergency flush 正常系 pin が引き続き green である。
- [ ] `src/background/sessionStore.ts:183` の `1MB` 固定文言が実値参照へ変わっている。
- [ ] session のキー集合に変更がない（追加・削除ともにゼロ）。
- [ ] `npx vitest run src/background/__tests__/sessionStore.test.ts --repeats=20` と `npm run validate` が成功している。
- [ ] 実ブラウザで `chrome.storage.session.getBytesInUse()` による quota 確認を実施し、結果が PR に残っている。
