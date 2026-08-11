# PBI: Saved URL entry moduleを深深化する

## 親PBI

`2026-08-11-01-architecture-deepening-epic.md`

## ユーザーストーリー

開発者として、Saved URL entry moduleの低水準なstorage知識を集約したい。これにより、記録処理がfield名、optimistic lock、mirror key、retention、retryを個別に扱わず、変更のlocalityとtestabilityを高めたい。

## スコープ

- `chrome.storage.local`へのSaved URL entry書き込みを集約する。
- metadata保存を複数の低水準書き込みから一つのドメイン操作へ整理する。
- optimistic lock、mirror同期、retention、quota recovery、retryを維持する。
- SQLite移行時に置き換え可能なseamを準備する。
- 既存のdual-write仕様を維持する。

## 非スコープ

- SQLite完全移行
- legacy dual-writeの削除
- Saved URL entry全読み取り経路の統合
- UI変更
- 新しいstorage方式の導入

## 依存関係

親PBIの開始条件を満たし、子PBI 2に先行して完了する。

## 受け入れ条件

```gherkin
Scenario: metadataを一つの操作として保存する
  Given 有効なSaved URL entryとmetadataがある
  When 記録処理がmetadata保存を実行する
  Then Saved URL entry moduleが必要なmetadataを保存する
  And 呼び出し側はfieldごとのstorage書き込みを実行しない
  And 既存の保存結果を保持する

Scenario: optimistic lockを維持する
  Given 同じSaved URL entryに並行更新が発生する
  When metadata保存を実行する
  Then optimistic lockが競合を検出する
  And 既存の競合時エラーまたはretry方針が維持される
  And 部分的なmetadataだけが成功状態として扱われない

Scenario: quota recoveryを維持する
  Given chrome.storage.localのquota超過が発生する
  When Saved URL entryの保存を実行する
  Then 既存のlegacy storage purge方針が適用される
  And retry可能な場合は既存のretry方針に従う
  And 保存失敗が成功値、空値、部分成功へ変換されない

Scenario: dual-writeを維持する
  Given legacy dual-writeが有効である
  When 記録処理が完了する
  Then SQLiteとchrome.storage.localの両方に必要な情報が保存される
  And fallback modeとlegacy history panelの挙動が変わらない

Scenario: dual-write無効化を維持する
  Given legacy dual-writeが無効である
  When 記録処理が完了する
  Then chrome.storage.localへのlegacy metadata書き込みは行われない
  And SQLiteへの保存は通常通り実行される
```

## テスト観点

- 正常系、optimistic lock競合、quota超過、purge後retry
- retry queueへの保持と再実行
- metadata対象field、dual-write有効・無効、fallback mode
- legacy history panelとduplicate checkの既存挙動
- 部分更新防止とstorage呼び出し回数
- interface越しのfake adapterまたは既存test seam

## 完了条件

- 呼び出し側がstorage内部知識を持たない。
- 保存処理の責務がSaved URL entry moduleへ集中している。
- BDDシナリオが成功している。
- 子PBI 2のhistory query統合に必要な保存契約が明確である。
- Manifest V3の非同期処理とService Worker lifecycleに違反しない。
