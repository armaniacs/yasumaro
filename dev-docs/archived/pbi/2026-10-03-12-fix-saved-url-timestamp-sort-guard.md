# PBI: savedUrlRepository の timestamp ソートに欠損ガードを入れる

## ユーザーストーリー

保守担当者として、`savedUrlsWithTimestamps` のエントリに timestamp 欠損（手作り・移行データ）が混入しても、ソートと content 削除の挙動が comparator の NaN による未定義にならず、同一モジュールの purgeLegacyStorage と同じ防御で決定的に扱われることを期待する。

## 優先度

- 順位: 12 / 15
- RICE: 1.6（R=2 / I=0.5 / C=0.8 / Effort=0.5）
- 根拠: 欠損 timestamp が混入するのは手作り・移行データのみで通常の write 経路では生成されない（Reach 2）。ただし混入時に comparator が NaN になり content 削除対象が未指定になる実在の未定義動作。実行時再現は未確認で配線確認済み（C=0.8）。

## 背景（file:line 付き現状）

- `src/utils/storage/savedUrlRepository.ts:38` — `capContentEntries` が `entries.slice().sort((a, b) => b.timestamp - a.timestamp)` で降順ソート。timestamp 欠損エントリが 1 件でもあると comparator が NaN を返し、ソート結果（= `:39` の `delete e.content` 対象）が未指定になる。`Array.prototype.sort` は NaN comparator を例外にしないため黙って通る。
- 型は欠損を許さない: `src/utils/urlEntry.ts:24-25` — `SavedUrlEntry` は `url: string; timestamp: number` で required。一方、同一モジュールの `purgeLegacyStorage` は `savedUrlRepository.ts:482` で `(b.timestamp || 0) - (a.timestamp || 0)` と欠損を防御しており、コードベース自身が「欠損があり得る」ことを認めている。
- 欠損が reader に流れる経路: `getSavedUrlsWithTimestamps` `:158` の `urlMap.set(entry.url, entry.timestamp)` は欠損時 `undefined` を Map に載せる。`setSavedUrlsWithTimestamps` `:238-242` は既存エントリの `timestamp` を `spreadExistingFields` `:82` で明示的に skip するため、urlMap 側に `undefined` を渡した呼び出しはそのまま `{ url, timestamp: undefined }` として書き戻る。
- `updateUrlTimestamp` 経路: `:287` の `entries.filter(entry => entry.timestamp >= cutoff)` は NaN >= cutoff が false になるため欠損エントリを pre-sort で黙って削除する。`:289-291` の LRU ソートも同様に comparator NaN を通る。

## BDD受け入れシナリオ

### Scenario 1: 欠損 timestamp が混在しても content 削除が決定的

```gherkin
Given savedUrlsWithTimestamps に timestamp を持つエントリと timestamp 欠損エントリ 1 件がある
When capContentEntries を含む書き込みが走る
Then 欠損エントリは timestamp 0 扱いで最古側に安定配置される
And 新しい MAX_CONTENT_ENTRIES 件の content が保持される
And comparator が NaN で未指定順にならない
```

### Scenario 2: 欠損エントリの扱いが purgeLegacyStorage の防御と同じ方針で決定的

```gherkin
Given 保存済みエントリに timestamp 欠損が 1 件ある
When updateUrlTimestamp が別 URL に対して実行される
Then 欠損エントリの扱い（0 扱いでの保持 / 明示的な除外）が purgeLegacyStorage と同じ方針で決定的になる
And 欠損の有無で他エントリの保持・削除が変わらない
```

## 受け入れ基準

- [x] 1. `src/utils/storage/savedUrlRepository.ts:38` の comparator が欠損 timestamp で NaN を返さない: `(timestamp || 0)` 正規化または事前 filter のいずれかで、`purgeLegacyStorage`（同ファイル `:482`）の既存防御と同じ方針に揃える。
- [x] 2. 欠損時の `capContentEntries` の content 削除対象が決定的になる（`:39` の `delete e.content` がタイムスタンプ順に従う）。
- [x] 3. `updateUrlTimestamp` `:287` の cutoff filter における欠損エントリの扱い（保持 or 除外）が方針として決定され、テストで固定される。
- [x] 4. `getSavedUrlsWithTimestamps` `:158` の `undefined` 搬入に対する方針（正規化 or 呼び出し側契約の明示）を決定する。
- [x] 5. 対象は `src/utils/storage/savedUrlRepository.ts` とそのテストに限定し、型 `src/utils/urlEntry.ts` は変更しない。

## テスト戦略

- 単体: chrome.storage モックに手作りデータ（欠損 timestamp 混在）を投入し、`capContentEntries` と `updateUrlTimestamp` を駆動して content 削除対象と保持が決定的であることを assert。
- 回帰: 既存の savedUrlRepository テスト一式が green。
- `npx vitest run <file> --repeats=20` で全 run green。

## 見積もり

2 SP（Effort 0.5）

## Definition of Done

- [x] BDD 2 シナリオがテストとして実装され green
- [x] 欠損 timestamp 混在時に comparator が NaN にならないことを assert するテストが存在する
- [x] updateUrlTimestamp / getSavedUrlsWithTimestamps の欠損扱い方針が決定・テスト固定されている
- [x] `npm run validate` が green
- [x] backlog（順位 12）としての完了報告が紐づく — アーカイブ/台帳更新は別ステップ

## 実装記録（2026-10-03）

- `capContentEntries`（`:38`）と LRU ソート（`:289-291`）の comparator を `(timestamp || 0)` 正規化に揃え、`purgeLegacyStorage`（同ファイル）と同じ `|| 0` 防御で統一。欠損エントリは 0 扱いで最古側に安定配置される。
- `updateUrlTimestamp` の cutoff filter（`:287`）も `(timestamp || 0) >= cutoff` に正規化 — 欠損エントリの扱いは「oldest → expired の明示ポリシー」で決定（旧挙動の `NaN >= cutoff` false による偶然の除外はポリシーではない旨を WHY コメントで記録）。
- `getSavedUrlsWithTimestamps`（`:158`）: `urlMap.set(entry.url, entry.timestamp || 0)` に正規化 — `undefined` 搬入の方針は正規化を選択（`Map<string, number>` 契約を正直に保ち、`setSavedUrlsWithTimestamps` の書き戻しで `timestamp: undefined` が往復しない。呼び出し側は 0 と undefined を同じく falsy で扱うため実挙動は不変）。
- テスト: `savedUrlRepository-timestamp-guard.test.ts` を新設（6 テスト: 欠損混在時の content 削除決定性、purge 防御との同一方針、cutoff 除外、reader 正規化）。修正前 RED を確認。隣接スイート 74/74 green。
- 検証: tsc --noEmit 0 エラー / npm test 15,465 pass / npm run validate exit 0。
- 逸脱: 受け入れ基準 4 は「方針を決定する」のみが要件だったが、実装として reader 正規化まで適用（決定だけでは `undefined` の往復書き戻しが残るため）。BDD 2 シナリオに加え reader 正規化のテストを追加。
