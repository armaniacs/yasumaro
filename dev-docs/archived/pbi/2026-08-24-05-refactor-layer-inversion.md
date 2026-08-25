# PBI: Layer 逆転 utils → background を constructor 注入に修正

## ユーザーストーリー
開発者として、`src/utils/storage/storageMaintenance.ts` が `background/sqliteClient` に依存するのをやめたい。なぜなら `LAYERS.md` は Layer 1 → Layer 0 のみを許容するが、dynamic import による例外が tolled by hiding で true seam になっていないから。

## 優先度
- 順位: 04 / 全候補数 7
- RICEスコア: 9.6（Reach=3 / Impact=2 / Confidence=80% / Effort=0.5人週）
- 根拠: 3 モジュールが直接関連。小 effort で Layer ルール違反を解消。`ensureStorageQuota` の `undefined` health check バグも修正される。

## BDD受け入れシナリオ

Scenario: SqliteHealthCheck が adapter seam として注入される
  Given `storageMaintenance.ts` が `await import('../../background/sqliteClient.js')` で background に依存している
  When `SqliteHealthCheck = () => Promise<boolean>` を Layer 0 に定義し `createBackgroundServices` から注入する
  Then `storageMaintenance.ts` は background を import しない
  And `SettingsRepository` / `saveSettings` が `SqliteHealthCheck` を明示的に受け取る

Scenario: offscreen document が chrome.storage を直接読み取らない
  Given `offscreen.ts` が `chrome.storage.local.get` で `OPFS_MIGRATION_*` を読み取る
  When Service Worker 経由の `DASHBOARD_SQLITE` メッセージでマイグレーションフラグを取得する
  Then offscreen document は `chrome.storage` に依存しない

## 受け入れ基準
- [ ] `storageMaintenance.ts` が `../../background/sqliteClient.js` を import しない
- [ ] `SqliteHealthCheck` interface が `src/utils/storage/types.ts` (Layer 0) に定義されている
- [ ] `createBackgroundServices.ts` が `SqliteHealthCheck` を `SettingsRepository` / `saveSettings` に注入している
- [ ] `offscreen.ts` の `chrome.storage.local.get` が SW メッセージ経由に置換されている（または deprecated として最小化）
- [ ] 既存の storage/quota テストが PASS する
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: `ensureStorageQuota` が `SqliteHealthCheck` を正しく使用することを検証
- **単体**: `SqliteHealthCheck` の `true` / `false` シナリオテスト

## 見積もり
0.5 ストーリーポイント（低 — 0.5 人週程度）

## 技術的考慮事項
- **依存**: なし
- **テスタビリティ**: `SqliteHealthCheck` は pure interface なので、テストは `() => Promise.resolve(true)` で注入可能
- **非機能要件**: Layer ルール準拠。`utils → background` 逆方向依存の除去。

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "await import" src/utils/storage/storageMaintenance.ts
grep -n "chrome.storage.local.get" src/offscreen/offscreen.ts
grep -n "OPFS_MIGRATION" src/offscreen/offscreen.ts
```

### 実装手順
1. `src/utils/storage/types.ts` に `SqliteHealthCheck = () => Promise<boolean>` を追加
2. `SettingsRepository` constructor に `healthCheck?: SqliteHealthCheck` を追加
3. `saveSettings` / `ensureStorageQuota` が `healthCheck` を受け取るように変更
4. `createBackgroundServices.ts` から `sqliteClient.healthCheck` メソッドを注入
5. `storageMaintenance.ts` の `await import('../../background/sqliteClient.js')` を削除
6. offscreen の `chrome.storage.local.get` を SW メッセージに置換（または最小化）

### 落とし穴
- `ensureStorageQuota` の legacy 呼び出し（`undefined` health check）が正しく fallback することを確認する。新規パスでは `healthCheck` を必須にするか、`undefined` 時に `() => true` でフォールバックする。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] LAYERS.md の Layer 1-循環 例外から `storageMaintenance.ts` を削除
- [ ] ドキュメント更新済み
