# PBI-0823a-04: settingsStore deprecated shim 退役

## ユーザーストーリー

開発者として、`settingsStore` の34 call sites を `SettingsRepository` に移行し shim を退役させたい。なぜなら `SettingsRepository` は polymorphic 済みだが誰も使わず、`ChromeStorageAdapter.getSettings()` が `dynamic import('./settingsStore.js')` で循環しているから。

## 優先度

- **順位**: 4 / 8
- **RICE**: 240 (Reach 10 × Impact 1.5 × Conf 60% / Effort 1.5w)
- **根拠**: 34箇所の StorageKeys 知識を1 seam に集約。B 完了後に着手（Bで DI が整うため）。
- **依存**: B（ServiceContainer 移行）完了後

## BDD受け入れシナリオ

```gherkin
Scenario: 新規コードで settingsStore 直import が lint で検出される
  Given eslint に no-restricted-imports で settingsStore 直import 禁止が設定されている
  When  新規ファイルで from './settingsStore.js' を import する
  Then  lint エラーになる

Scenario: ChromeStorageAdapter が循環なしで動作する
  Given ChromeStorageAdapter.getSettings() が chrome.storage.local 直読み + migration 直呼びで実装されている
  When  getSettings() を呼ぶ
  Then  SettingsRepository 経由でも直接でも同じ結果が返る
```

## 受け入れ基準

- [x] `settingsStore.ts` を `storage/settingsStore.legacy.ts` に退避
- [x] `ChromeStorageAdapter` を `chrome.storage.local` 直読み + `settingsMigration.applyMigrationsAndDecrypt` 直呼びに変更（循環断つ）
- [x] 34 call sites を `SettingsRepository` 経由に機械置換
- [x] eslint `no-restricted-imports` で `from.*settingsStore` 新規 import を禁止
- [x] `npm run type-check` / `npm test` PASS

## テスト戦略

- **統合**: 34 call sites の置換前後で同一 Settings が読めること
- **単体**: ChromeStorageAdapter の直読み + migration パス

## 見積もり

8pt（1.5人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] `from.*settingsStore` がテスト mock 以外 0件
- [x] コードレビュー完了
