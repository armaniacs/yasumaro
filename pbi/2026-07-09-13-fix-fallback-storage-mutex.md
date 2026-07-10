# PBI: FallbackStorageのinsert/insertBatchにMutex導入し競合状態を解消

## ユーザーストーリー
ユーザーとして、OPFSが利用不可な環境（フォールバックストレージ動作時）で複数タブから同時に閲覧履歴を記録しても、レコードが欠損したり上書きされたりしないでほしい、なぜなら現状は `loadData()`→重複チェック→`getNextId()`→push→`saveData()` の一連の処理が非アトミックなため、2つのタブが同時に記録を開始するとID重複やデータ上書きが発生するから

## ビジネス価値
- OPFS非対応環境（フォールバック動作）でのデータ整合性を保証する
- 複数タブでの同時ブラウジングという一般的な利用パターンでのデータロスを防ぐ

## 背景（レビュー指摘）
- 指摘者: Data Integrity Expert（[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) High指摘6件目）
- 場所: `src/offscreen/storageFallback.ts:38-148`（`insert()`, `insertBatch()`）
- 現状: `FallbackStorage.insert()` と `insertBatch()` はそれぞれ `chrome.storage.local` から現在の全レコードを読み込み（`loadData()`）、メモリ上で重複チェック・ID採番・配列へのpushを行った後、全体を書き戻す（`saveData()`）。この一連の read-modify-write サイクルはアトミックではなく、2つの呼び出しが並行実行されると片方の変更が失われる（lost update）。
- 決定事項: `loadData`→変更→`saveData` のサイクルを排他する簡易Mutexを導入する。→ この方針で行く

## BDD受け入れシナリオ

```gherkin
Scenario: 2つのタブが同時にinsertしても両方のレコードが保存される
  Given OPFSが利用不可でFallbackStorageが使用されている
  And 既存のレコードが0件である
  When タブAとタブBがほぼ同時に異なるURLのレコードをinsert()する
  Then 両方のレコードが保存される
  And 2件のレコードそれぞれに一意なIDが採番されている

Scenario: insertとinsertBatchが同時に実行されてもデータが欠損しない
  Given FallbackStorageに既存レコードが存在する
  When 1件のinsert()と3件のinsertBatch()がほぼ同時に呼び出される
  Then 呼び出し前の既存レコード数 + 1 + 3 件のレコードが最終的に保存されている
  And いずれのレコードも上書きされていない

Scenario: 同一URL・同一created_atの重複レコードは引き続き除外される
  Given 既に同一のurlとcreated_atを持つレコードが保存されている
  When 同じurl・created_atを持つレコードを別のタブからinsert()する
  Then 重複としてスキップされ、レコード数は増加しない
```

## 受け入れ基準
- [ ] `FallbackStorage` クラスに、insert系操作を排他制御するMutex（既存の `src/background/Mutex.ts` を再利用または同等の軽量実装）が導入されている
- [ ] `insert()` の `loadData()`→重複チェック→`getNextId()`→push→`saveData()` の一連の処理がMutexで保護され、並行呼び出し時にシリアライズされる
- [ ] `insertBatch()` も同様にMutexで保護される
- [ ] `insert()` と `insertBatch()` が同時に呼ばれた場合も互いに排他される（同一Mutexインスタンスを共有する）
- [ ] 既存のquery/update/delete等の読み取り専用操作のパフォーマンスに大きな影響を与えない（書き込み系のみ排他対象とする）
- [ ] 並行呼び出しを行うテストで、レコード欠損・ID重複が発生しないことが確認できる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- （Service Worker/Offscreen内部の並行処理のため、E2Eでの再現は困難。統合テストで代替する）

### 統合テスト
- `FallbackStorage` インスタンスに対し `Promise.all()` で複数の `insert()` / `insertBatch()` を同時実行し、全レコードが欠損なく保存されることを検証する統合テスト
- 意図的にMutex導入前のコードで同テストを実行し、レースコンディションが再現する（テストが失敗する）ことを確認してからMutexを導入する

### 単体テスト
- `insert()` を単体で呼び出した場合の従来動作（正常保存、重複スキップ）が変わらないことの回帰テスト
- `insertBatch()` も同様の回帰テスト
- Mutexの取得・解放が正しく行われる（例外発生時もロックが解放される）ことの単体テスト

## 実装アプローチ
- **Outside-In**: まず並行実行時のレースコンディションを再現する統合テストを書き、失敗することを確認する
- **Red-Green-Refactor**: Mutexを導入し、テストがグリーンになることを確認する
- **リファクタリング**: `insert()` と `insertBatch()` の重複コード（PBI-09と関連するがこちらはchrome.storageベースのため別スコープ）を、Mutex導入のついでに整理できないか検討する（無理に統合はしない）

## 見積もり
3pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 既存の `src/background/Mutex.ts` の実装がOffscreen Document内でも利用可能か確認が必要（Service Worker専用実装であれば同等品をoffscreen側に用意する）
- テスタビリティ: `chrome.storage.local` のモックで並行アクセスをシミュレートする（Promise.allで複数呼び出しをまとめて発火させる）
- 非機能要件: Mutexによる直列化で書き込みのスループットは低下するが、フォールバックストレージは元々OPFS利用不可時の代替経路であり許容範囲

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
cat src/background/Mutex.ts
grep -rn "new Mutex\|Mutex(" src/background/ src/offscreen/
grep -n "class FallbackStorage" src/offscreen/storageFallback.ts
```
`Mutex.ts` がService Worker専用の実装（chrome API依存など）でないか確認し、Offscreen Document内で問題なくimportできるか確かめること。

### 実装手順
1. `src/offscreen/storageFallback.ts` に `Mutex` のインスタンスをクラスフィールドとして持たせる（`private readonly mutex = new Mutex();`）
2. `insert()` の本体処理（`loadData()`〜`saveData()`）を `mutex.runExclusive(async () => { ... })` 相当でラップする
3. `insertBatch()` も同様にラップする
4. 例外発生時もロックが必ず解放されることを確認する（`Mutex` の実装がtry/finally相当を内包しているか確認）
5. 並行実行の統合テストを追加し、Mutex導入前後で結果が変わることを確認する

### 落とし穴
- `getNextId()` も `chrome.storage.local` への read-modify-write であり、`insert()`/`insertBatch()` 全体を1つのMutexでラップしないと `getNextId()` だけ別タイミングで実行されて依然として競合しうる。ロック範囲は「loadData開始からsaveData完了まで」全体を含めること
- `Mutex` がPromiseベースの単純な実装の場合、同一プロセス内（同一Offscreen Documentインスタンス内）でのみ有効。複数のOffscreen Documentが同時に存在するケースがないか確認すること（通常Offscreen Documentは単一インスタンスのはず）
- 既存のinsert/insertBatchの重複コード（30カラム分のオブジェクト構築）に触れる可能性があるため、PBI-09（[2026-07-09-09-fix-dedupe-insert-sql-columns.md](2026-07-09-09-fix-dedupe-insert-sql-columns.md)）と同時に着手する場合は競合に注意する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（該当する場合）
