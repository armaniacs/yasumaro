# PBI: SettingsRepository shim を廃止し StorageAdapter 注入に完全移行

## ユーザーストーリー
開発者として、SettingsRepository の本番パスとテストパスを分離したい。なぜなら test seam が本番コードに漏洩しており、暗号化・マイグレーションロジックのテストカバレッジが信用できないから。

## 優先度
- 順位: 01 / 全候補数 7
- RICEスコア: 22.5（Reach=15 / Impact=3 / Confidence=100% / Effort=2人週）
- 根拠: 他の PBI（#2 StorageKeys facade、#4 Pipeline deps、#6 extractor settings）が SettingsRepository の clean seam を前提とするため、依存関係上最優先。Reach は 15+ の legacy import + 全テストスイート。

## BDD受け入れシナリオ

Scenario: 本番コードが legacy shim に依存しない
  Given `src/utils/storage/settingsStore.legacy.ts` が存在する
  And `SettingsRepository` に `tryLegacyGetAll` / `tryLegacySave` が実装されている
  When shim を削除し `StorageAdapter` 注入に移行する
  Then `settingsStore.legacy.ts` は削除されている
  And `SettingsRepository` の全 public メソッドは adapter 経由で動作する
  And `InMemoryStorageAdapter.getSettings` が `applyMigrationsAndDecrypt` + `DEFAULT_SETTINGS` fill を実行する

Scenario: テストが InMemoryStorageAdapter で動作する
  Given `InMemoryStorageAdapter` が `SettingsRepository` に注入される
  When テストが `repo.getAll()` を呼び出す
  Then `chrome.storage` モックは不要である
  And 暗号化・マイグレーションが適用された状態でテストが実行される

## 受け入れ基準
- [ ] `tryLegacyGetAll` / `tryLegacySave` が SettingsRepository から削除されている
- [ ] `settingsStore.legacy.ts` が削除されている（または `@deprecated` shim として最小化）
- [ ] `SettingsRepository` constructor が `StorageAdapter` を必須引数とする
- [ ] `InMemoryStorageAdapter.getSettings` が本番と同一のマイグレーション・暗号化パスを通る
- [ ] `no-restricted-imports` が `settingsStore(.legacy)` を production コードで禁止する
- [ ] 15+ の legacy import が `SettingsRepository` 直接 import に移行されている
- [ ] 既存テストが adapter 注入で動作する（chrome.storage モック依存なし）
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: `SettingsRepository` が `ChromeStorageAdapter` と `InMemoryStorageAdapter` の両方で動作することを検証
- **単体**: `InMemoryStorageAdapter.getSettings` が `applyMigrationsAndDecrypt` を実行することを検証
- **契約**: `no-restricted-imports` が production コードで `settingsStore(.legacy)` をブロックすることを検証

## 見積もり
2 ストーリーポイント（中 — 2 人週程度）

## 技術的考慮事項
- **依存**: なし。他の PBI の前提となるため最優先。
- **テスタビリティ**: `InMemoryStorageAdapter` を constructor 注入に変更することで、テストは `chrome.storage` モックを完全に排除できる。
- **非機能要件**: 暗号化・マイグレーションロジックのテストカバレッジ向上。本番とテストのコードパス統一。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "tryLegacy" src/utils/storage/
grep -rn "settingsStore\.legacy" src/ --include="*.ts"
grep -rn "from.*settingsStore" src/ --include="*.ts" | grep -v "__tests__"
```

### 実装手順
1. `SettingsRepository` の constructor を `constructor(private adapter: StorageAdapter)` に変更
2. `tryLegacyGetAll` / `tryLegacySave` を削除
3. `getAll` / `get` / `set` が `this.adapter` 経由で動作することを確認
4. `InMemoryStorageAdapter.getSettings` に `applyMigrationsAndDecrypt` + `DEFAULT_SETTINGS` fill を追加
5. `settingsStore.legacy.ts` の production import を `SettingsRepository` 直接 import に codemod
6. `eslint.config.js` に `no-restricted-imports` を追加（`settingsStore(.legacy)` を禁止）
7. テストを adapter 注入形式に更新

### 落とし穴
- `InMemoryStorageAdapter` は現在 `DEFAULT_SETTINGS` をそのまま返すのみ。本番の `applyMigrationsAndDecrypt` を再実装する必要がある。
- `saveSettings` 経由の呼び出しが `adapter.set` を迂回していないか確認する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の storage セクション）
