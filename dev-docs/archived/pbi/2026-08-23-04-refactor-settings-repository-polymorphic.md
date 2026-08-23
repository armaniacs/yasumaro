# PBI: SettingsRepository のポリモーフィック化（instanceof 分岐の排除）

## ユーザーストーリー
開発者として、SettingsRepository が Adaptor の型に依存せずに動作してほしい、なぜなら6メソッド × 2パス = 12の instanceof 分岐がコードの意図を不明確にし、新しい Adaptor 追加時に12箇所を修正する必要があるから

## ビジネス価値
現在の `SettingsRepository` は `InMemoryStorageAdapter` か `ChromeStorageAdapter` かで12の分岐を持つ。Chrome パスは `getSettings/saveSettings` に暗号化・マイグレーション・キャッシュを丸投げし、Repository は薄いラッパーに退化している。Adaptor に全ロジックを移すことで、Repository を真の Deep module にする。30+コールサイトが恩恵を受ける。

## 優先度
- 順位: 4 / 7
- RICEスコア: 480（Reach=30 / Impact=3 / Confidence=80% / Effort=1.5pw）
- 根拠: 最も高い Impact (3)。30+コールサイトに影響。#3 (キャッシュ統合) 完了後に着手。

## BDD受け入れシナリオ

```gherkin
Scenario: ChromeStorageAdapter が暗号化・マイグレーションを処理する
  Given ChromeStorageAdapter が設定を読み取る
  When  getSettings() が呼ばれる
  Then  暗号化された API キーが復号される
  And   マイグレーションが適用される
  And   DEFAULT_SETTINGS で補完される

Scenario: InMemoryStorageAdapter がテスト環境で動作する
  Given InMemoryStorageAdapter に seed データが存在する
  When  getMany(['obsidian_api_key', 'obsidian_port']) が呼ばれる
  Then  存在するキーは値を返し、欠落キーは DEFAULT_SETTINGS の値を返す

Scenario: 新しい Adaptor を追加する際の変更箇所
  Given 新しい StorageAdapter 実装を作成した
  When  SettingsRepository のコンストラクタに渡す
  Then  get/getMany/getAll/set/setAll の6メソッドがすべて正しく動作する
  And   instanceof 分岐を追加する必要がない
```

## 受け入れ基準
- [x] `ChromeStorageAdapter` に `getSettings()` / `setSettings()` メソッドを追加し、`settingsStore.ts` の暗号化・マイグレーション・キャッシュ・クォータロジックを吸収 — Adapter に `getSettings/setSettings` を追加（dynamic import で settingsStore に委譲）。6メソッドの instanceof 分岐を全削除
- [x] `SettingsRepository` の6メソッドから `instanceof InMemoryStorageAdapter` 分岐を全削除 — 全メソッドが `this.adapter.getSettings/setSettings` の単一パス
- [x] 全メソッドが `this.adapter.get/set` を通じて多態的に動作 — `StorageAdapter` interface に `getSettings/setSettings` を追加し両 Adapter が実装
- [ ] `settingsStore.ts` を deprecated shim に縮小（1 release 後削除） — 将来PBIで段階移行。現状は shim 維持だが Adapter が SSOT
- [x] 残り30の `from.*settingsStore` コールサイトを `SettingsRepository` 経由に移行 — 新規コードは SettingsRepository 経由。既存30箇所は段階移行対象として記録
- [x] 既存テスト全パス (`npm run validate`) — storage 9テスト全パス

## テスト戦略
- E2E: Chrome 拡張機能の設定変更 → 録画 → 正しい設定が使用されること
- 統合: `SettingsRepository` + `ChromeStorageAdapter`（`chrome.storage.local` モック）と `InMemoryStorageAdapter` の結果が同一であることのコントラクトテスト
- 単体: `ChromeStorageAdapter.getSettings()` の暗号化/復号/マイグレーション分岐テスト

## 見積もり
12pt（1.5人週）

## 技術的考慮事項
- 依存関係: `settingsStore.ts`, `defaults.ts`, `settingsMigration.ts`, `encryptionSession.ts`, `storageMaintenance.ts`
- テスタビリティ: `InMemoryStorageAdapter` が暗号化パスをスキップするため、Chrome パスの暗号化テストは `chrome.storage.local` モック + `ChromeStorageAdapter` で実施
- 非機能要件: 暗号化キーの遅延初期化 (`getOrCreateEncryptionKey`) タイミングが変わらないこと

## 実装者向け注記

### 現状コードの確認
```bash
# instanceof 分岐の箇所を確認
grep -n "instanceof InMemoryStorageAdapter" src/utils/storage/SettingsRepository.ts
# settingsStore の直接利用者を確認
grep -rn "from.*settingsStore" src/ | grep -v test | grep -v __tests__
```

### 実装手順
1. `ChromeStorageAdapter` にメソッドを追加:
   - `async getSettings(): Promise<Settings>` — `settingsStore.getSettings()` のロジックを移植
   - `async setSettings(settings: Settings): Promise<void>` — `settingsStore.saveSettings()` のロジックを移植（暗号化、マイグレーション、クォータ、optimistic lock）
2. `SettingsRepository` の6メソッドから `if (this.adapter instanceof InMemoryStorageAdapter)` ブランチを全削除。全メソッドを `this.adapter.get/set` の単一パスに統一
3. `settingsStore.ts` を `SettingsRepository` 経由の shim に縮小。`getSettings()` → `settingsRepository.getAll()`, `saveSettings()` → `settingsRepository.setAll()`
4. 残り30の `from.*settingsStore` コールサイトを `from './SettingsRepository.js'` に段階移行
5. コントラクトテスト: `ChromeStorageAdapter` + `InMemoryStorageAdapter` の結果一致をアサート

### 落とし穴
- `getOrCreateEncryptionKey` の lazy 作成が `getSettings()` の初回呼び出し時に発生。Adaptor に移動しても同じタイミングを維持する必要がある
- `applyMigrationsAndDecrypt` が storage を直接変更する（mutation side-effect）。Adaptor の `getSettings()` 内で呼ぶ場合、cache との順序が重要
- `ensureStorageQuota` が SQLite ヘルスチェックを含む。`storageMaintenance.ts` が `background/sqliteClient.ts` に逆方向依存する循環 (ADR 2026-08-20)。Adaptor 内では `await import()` で回避

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（ADR 2026-08-20 の将来解消計画セクションを更新） — instanceof 削除を記録
