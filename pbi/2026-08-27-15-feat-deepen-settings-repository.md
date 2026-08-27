# PBI: SettingsRepository の StoragePort 一本化

## ユーザーストーリー
開発者として、`SettingsRepository` の `Chrome` vs `InMemory` 二重実装と `defaults`/`migration`/`encryption` の4箇所散在を1つの `Settings` モジュールに統合したい、なぜならデフォルト1つ変更で4ファイルを同時編集し、`InMemory` と `Chrome` の挙動差が parity test なしで発散するから。

## 優先度
- 順位: 4 / 7
- RICEスコア: 300（Reach=70 / Impact=2 / Confidence=70% / Effort=0.35）
- 根拠: 全機能が `getSettingsWithCache` に依存する横断的ホットスポット。将来の `AI_PROVIDER_PRIORITY_LIST` 追加で工数半減。

## なぜなぜ分析
- なぜ散在するか: `ChromeStorageAdapter.getSettings()` と `InMemoryStorageAdapter.getSettings()` で migration/復号ロジックが二重実装
- なぜ気づかないか: `InMemory` は `rawEncrypted:false` で別経路だがテストでしか使われない
- 解: `Settings { get, set, observe }` が `defaults + migration + encryption + quota` を内部で完結させ、`StoragePort` 1 seam に統一

## BDD受け入れシナリオ
Scenario: ハッピーパス — get/set が typed key のみで完結する
  Given `Settings.get(StorageKeys.OBSIDIAN_API_KEY)` を呼ぶ
  When 値を取得する
  Then `chrome.storage.local` の内部構造を意識せずに値が返る

Scenario: エッジケース — デフォルト変更が1ファイルで完結する
  Given `defaults.ts` に新キーを追加する
  When 保存する
  Then `SettingsRepository`/`InMemory` の両方で同じ新キーが有効になる

## 受け入れ基準
- [ ] `Settings` が `get`/`set`/`observe` の3メソッドで typed key のみを公開する
- [ ] `Chrome` と `InMemory` が `StoragePort` 1 seam に統一されている
- [ ] `getSettings`/`setSettings` の二重実装が廃止されている

## テスト戦略
- 単体: `Settings` の `get`/`set`/`observe` の typed key テスト
- 統合: 実 `chrome.storage` と `InMemory` での parity テスト
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
