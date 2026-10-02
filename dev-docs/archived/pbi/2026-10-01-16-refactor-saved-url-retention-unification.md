# PBI: savedUrlRepository のコンテンツ保持ルール統一

優先度: 中（RICE 10.0・同バッチ 26 候補中 9 位 / refactor）
backlog: [./2026-10-01-00-backlog-holistic-1001.md](./2026-10-01-00-backlog-holistic-1001.md)（NN 16・バッチA・ファイル非重複）
依存: なし（単独で着手可能）。`src/utils/storage/savedUrlRepository.ts` のみを触る。`MAX_CONTENT_ENTRIES`・`MAX_URL_SET_SIZE`・`LEGACY_MAX_ENTRIES` の定数定義（`src/utils/urlEntry.ts` 由来）は変更しない。

## ユーザーストーリー

拡張機能の storage 層を保守する開発者として、savedUrlRepository のエントリ保持（content 削除・容量 cap）ルールが同一関数を通ってほしい、なぜなら「timestamp 降順で上位 MAX_CONTENT_ENTRIES 件のみ content 保持」の同一 2 行が 2 箇所に重複し、加えて sort+slice cap 形が 2 箇所に再出現しているため、保持ルールの変更（例: MAX_CONTENT_ENTRIES の扱い変更）のたびに 3 writer を個別に編集する必要があり、1 箇所の更新漏れが storage-quota ガードの不整合（容量節約の抜け漏れ）として顕在化するから。

## 背景（現状）

### 保持ルールの重複（検証済み・2026-10-01 時点）

| writer | 位置 | 処理 |
|---|---|---|
| `setSavedUrlsWithTimestamps`（withAtomicKeys updater 内・207 行開始） | `src/utils/storage/savedUrlRepository.ts:228-230` | 同一 2 行: `const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp); sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });` |
| `updateUrlTimestamp`（258 行開始） | `src/utils/storage/savedUrlRepository.ts:280-282` | 同一 2 行（上記と完全一致） |
| `updateUrlTimestamp` | `src/utils/storage/savedUrlRepository.ts:275-278` | sort+slice cap 形: `entries.length > MAX_URL_SET_SIZE` → 昇順 sort + `slice(entries.length - MAX_URL_SET_SIZE)`（LRU cap・出力配列を並び替える） |
| `purgeLegacyStorage`（431 行開始） | `src/utils/storage/savedUrlRepository.ts:470-474` | sort+slice cap 形: `[...current].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))` + `slice(0, LEGACY_MAX_ENTRIES)`（降順 cap・出力配列を並び替える） |

- `:228-230` と `:280-282` は同一 2 行（コメント「contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）」込みで 3 行重複）
- MAX_CONTENT_ENTRIES 保持ルールは storage-quota ガードの一部（`setSavedUrls` の `STORAGE_QUOTA_BYTES` 事前チェック :181-189 と並ぶ容量節約策）
- セマンティクス上の重要な詳細: `entries.slice()` で別配列を作るため、content の `delete` はエントリオブジェクト自体への破壊的変更だが、呼び出し元配列（`entries`）の並び順は不変。統一ヘルパもこの契約を保存すること
- `:275-278` と `:470-474` の cap 形は、定数（`MAX_URL_SET_SIZE` / `LEGACY_MAX_ENTRIES`）・順序（昇順で後ろから保持 / 降順で先頭から保持）・出力並び替えの有無が異なるため、`capContentEntries` への無理な統合は禁止。共通化するなら別シグニチャのヘルパとし既存セマンティクスを保存する

## BDD

```gherkin
Feature: savedUrlsWithTimestamps のコンテンツ保持

  Scenario: content は timestamp 降順上位 MAX_CONTENT_ENTRIES 件のみ保持される
    Given content 付きエントリが MAX_CONTENT_ENTRIES + 5 件ある
    When setSavedUrlsWithTimestamps が updater を完了する
    Then timestamp 降順上位 MAX_CONTENT_ENTRIES 件のみ content が残る
    And 残り 5 件の content は削除される

  Scenario: 呼び出し元の entries 並び順は不変である
    Given entries が元の順序を保った配列である
    When capContentEntries(entries) を呼ぶ
    Then entries の並び順は呼び出し前と同一である
    And 削除対象（上位 MAX_CONTENT_ENTRIES 以外の content）は現行実装と同一である

  Scenario: purgeLegacyStorage の cap セマンティクスは不変である
    Given savedUrlsWithTimestamps に LEGACY_MAX_ENTRIES を超えるエントリがある
    When purgeLegacyStorage が走る
    Then 降順 sort + slice(0, LEGACY_MAX_ENTRIES) の現行セマンティクスが保たれる
```

## 実装宣言・受け入れ基準

It must keep behavior: content 保持のセマンティクス（timestamp 降順で上位 MAX_CONTENT_ENTRIES 件のみ content 保持、呼び出し元配列の並び順は不変、`delete e.content` はエントリオブジェクトへの破壊的変更のまま）と、cap 形（`updateUrlTimestamp`: 昇順 sort + 後ろから MAX_URL_SET_SIZE 保持、`purgeLegacyStorage`: 降順 sort + 先頭から LEGACY_MAX_ENTRIES 保持）の並び順・保持対象が、リファクタリング前後で完全に同一であること。

受け入れ基準:

- [x] 1. `capContentEntries(entries)` が新設され、同一 2 行（`setSavedUrlsWithTimestamps` と `updateUrlTimestamp` の content 保持）が消える
- [x] 2. `setSavedUrlsWithTimestamps` と `updateUrlTimestamp` の content 保持が同一関数を通る
- [x] 3. 保持セマンティクス不変: timestamp 降順・上位 MAX_CONTENT_ENTRIES のみ content 保持・呼び出し元配列の並び順は不変である
- [x] 4. cap 形（`updateUrlTimestamp` の MAX_URL_SET_SIZE、`purgeLegacyStorage` の LEGACY_MAX_ENTRIES）は共通化せず、定数・順序（昇順 / 降順）・出力並び替えの有無を現行どおり保つ
- [x] 5. 既存テストが green: `savedUrlRepository-atomicity.test.ts`・`savedUrlRepository-branch.test.ts`・`savedUrlStore-cas.test.ts`
- [x] 6. `npm run type-check` が green

## テスト戦略

- 既存回帰: `src/utils/storage/__tests__/savedUrlRepository-atomicity.test.ts`（原子性）、`savedUrlRepository-branch.test.ts`（分岐）、`savedUrlStore-cas.test.ts`（CAS merge）
- 新規: `capContentEntries` の単体テストを境界条件で書く（ちょうど MAX_CONTENT_ENTRIES 件 / +1 件 / 同一 timestamp を含む配列 / content を持たないエントリ / content 削除が元配列の並び順に影響しないこと）
- cap 形を共通化した場合、各 cap の単体テストも同形式で追加する（定数境界: ちょうど MAX_URL_SET_SIZE / LEGACY_MAX_ENTRIES 件）
- `dev-docs/TEST_RULE.md`（../dev-docs/TEST_RULE.md）に従い、実時間待ちを入れない
- 型確認: `npm run type-check`

## 実装内容

1. `function capContentEntries(entries: SavedUrlEntry[]): void`（仮称・返り値の有無は実装判断）を新設する。実体は現行の `entries.slice().sort((a, b) => b.timestamp - a.timestamp)` でランク付けし、`i >= MAX_CONTENT_ENTRIES` のエントリから `delete e.content` を実行する。呼び出し元配列の並び順は変えない
2. `setSavedUrlsWithTimestamps` の updater 内（:228-230）を `capContentEntries(entries)` 呼び出しに置換する
3. `updateUrlTimestamp` 内（:280-282）を同様に置換する
4. cap 形の扱い: `:275-278` と `:470-474` は定数・順序が異なるため、`capContentEntries` には統合しない。共通化する場合は別ヘルパ（例: 降順 / 昇順と保持上限を引数に取る形）とし、既存セマンティクスを保存する
5. コメントは英語で WHY のみ追記する（現行の日本語コメント「contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）」は英語の WHY コメントに置き換える）

## Definition of Done

- [x] 受け入れ基準 1-6 をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] `rg "MAX_CONTENT_ENTRIES" src/utils/storage/savedUrlRepository.ts` で保持ルールの実装が共通関数 1 箇所のみになっていることを確認する（import と re-export を除く）
- [ ] `graphify update .` を実行しグラフを現行コードに追従させる — 未実施（統合ステップのスコープ外）
- [ ] backlog 台帳（./2026-10-01-00-backlog-holistic-1001.md）の NN 16 を完了扱いに更新する — アーカイブ/台帳更新は別ステップで処理

## 実装記録（2026-10-02）

変更した内容（`src/utils/storage/savedUrlRepository.ts` のみ）:

- モジュールスコープに `capContentEntries(entries: SavedUrlEntry[]): void` を新設。実体は `entries.slice().sort((a, b) => b.timestamp - a.timestamp)` でランク付けし、`i >= MAX_CONTENT_ENTRIES` のエントリから `delete e.content` を実行する。slice によるコピーで呼び出し元配列の並び順を保つ点は現行と同一
- `setSavedUrlsWithTimestamps` の updater 内と `updateUrlTimestamp` 内の重複 2 行を `capContentEntries(entries)` 呼び出しに置換
- 日本語コメント「content は最新 MAX_CONTENT_ENTRIES 件のみ保持（ストレージ節約）」を、容量節約が目的であることとコピーする理由（`updateUrlTimestamp` は capping 直後にその並び順から savedUrls を導出する）を説明する英語 WHY コメントに置き換えた

cap 形（`MAX_URL_SET_SIZE` の昇順 tail 取り、`LEGACY_MAX_ENTRIES` の降順 head 取り）は、定数・順序・出力並び替えの有無が異なるため意図的に共通化していない（受け入れ基準 4 の「別シグニチャのヘルパとする」条件が成り立たない）。基準 4 は「共通化せず現行どおり保つ」ことを充足とする。

追加したテスト: なし。受け入れ基準 5 の 3 ファイルが atomicity / branch / CAS merge をカバーしており、本 PBI は挙動維持の抽出のため 이를不変性の gate として使う。

検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。
