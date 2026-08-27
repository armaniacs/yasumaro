# PBI: SettingsRepository の StoragePort 一本化

## ユーザーストーリー
開発者として、`SettingsRepository` の `Chrome` vs `InMemory` 二重実装と `defaults`/`migration`/`encryption` の4箇所散在を1つの `Settings` モジュールに統合したい、なぜならデフォルト1つ変更で4ファイルを同時編集し、`InMemory` と `Chrome` の挙動差が parity test なしで発散するから。

## 優先度
- 順位: 4 / 7
- RICEスコア: 257（Reach=70 / Impact=2 / Confidence=55% / Effort=0.30） — 再評価で Confidence 70→55 に下方修正。`get` 時の re-encrypt 副作用と `optimisticLock` の `chrome` 結合を設計で明示的に処理する必要があり、2pt は過小。3pt (0.5w) が適正。2pt で収めるなら `optimisticLock` をスコープ外に縮退。
- 根拠: 全機能が `getSettingsWithCache` に依存する横断的ホットスポット。将来の `AI_PROVIDER_PRIORITY_LIST` 追加で工数半減だが、現行 `Chrome` vs `InMemory` の `applyMigrationsAndDecrypt` における `rawEncrypted:false` 分岐と `encryptionSession` の `KeyProvider` 注入が隠れた結合として顕在化。

## なぜなぜ分析
- なぜ散在するか: `ChromeStorageAdapter.getSettings:54` と `InMemory:152` で migration/復号ロジックが二重実装。`Chrome` は `applyMigrationsAndDecrypt` + `tryRestoreFromBackup` + `validKeys` フィルタ + `re-encrypt` 副作用を `get` 経路で実行
- なぜ気づかないか: `InMemory` は `rawEncrypted:false` で別経路だがテストでしか使われない。`settingsRepository-migration-parity.test.ts` で `rawEncrypted:false` 分岐としてテスト回避されている
- 解: Phase1: `StoragePort { get/set/onChanged/getBytesInUse }` の純粋化 (get/set/onChanged のみ)。Phase2: `Settings { get,set,observe }` が `defaults + migration + encryption + quota` を内部で完結。`applyMigrationsAndDecrypt` の re-encrypt 副作用は `Settings.getAll` 内で Port 経由に書き換え、`optimisticLock` は `Settings` 層で `chrome` 専用として明記し `InMemory` は version 模倣を Port に持たせない

## BDD受け入れシナリオ
Scenario: ハッピーパス — get/set が typed key のみで完結する
  Given `Settings.get(StorageKeys.OBSIDIAN_API_KEY)` を呼ぶ
  When 値を取得する
  Then `chrome.storage.local` の内部構造を意識せずに値が返る。`StoragePort` は薄いラッパのみ

Scenario: エッジケース — デフォルト変更が1ファイルで完結する
  Given `defaults.ts` に新キーを追加する
  When 保存する
  Then `Settings` の `get`/`set` で同じ新キーが有効になり、`Chrome`/`InMemory` の両 adapter で parity が保たれる。`rawEncrypted` フラグは廃止

## 受け入れ基準
- [x] Phase1: `StoragePort` が `get/set/onChanged/getBytesInUse` のみに純粋化されている
- [x] Phase2: `Settings` が `get`/`set`/`observe` の3メソッドで typed key のみを公開し、`Chrome` と `InMemory` が `StoragePort` 1 seam に統一されている
- [x] `getSettings`/`setSettings` の二重実装 (`StorageAdapter` 型) が廃止され、`applyMigrationsAndDecrypt` の `rawEncrypted` 分岐が削除されている
- [x] `re-encrypt` 副作用が `Settings.getAll` 内で Port 経由に書き換えられている

## テスト戦略
- 単体: `Settings` の `get`/`set`/`observe` の typed key テスト。`StoragePort` の `get/set/onChanged` の純粋化テスト
- 統合: 実 `chrome.storage` と `InMemory` での parity テスト。`rawEncrypted:false` 削除後の再設計で `InMemory` でも `KeyProvider` 注入を検証
- E2E: 不要

## 見積もり
3pt（Phase1+2, 要チームでの見積もり） — 2pt で収めるなら `quota + encryption` を `optimisticLock` 除外で縮退

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
