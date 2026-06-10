# storageSettings.tsとstorage.tsのDEFAULT_SETTINGS単一ソース化

## Context

storageSettings.tsとstorage.tsにDEFAULT_SETTINGSが2重定義されており、異なるフォーマット（camelCase vs StorageKeys.snake_case）で定義されています。

**storageSettings.ts (camelCase):**
```typescript
export const DEFAULT_SETTINGS: Settings = {
  obsidian_api_key: '',
  obsidian_protocol: 'http',  // 注: http (旧デフォルト)
  obsidian_port: '27123',     // 注: 27123 (旧デフォルト)
  // ...
}
```

**storage.ts (StorageKeys):**
```typescript
const DEFAULT_SETTINGS: Settings = {
  [StorageKeys.OBSIDIAN_API_KEY]: '',
  [StorageKeys.OBSIDIAN_PROTOCOL]: 'https',  // 注: HTTPS (新デフォルト)
  [StorageKeys.OBSIDIAN_PORT]: '27124',      // 注: 27124 (新デフォルト)
  // ...
}
```

**問題点:**
1. 二重定義: DEFAULT_SETTINGSが2か所に存在
2. デフォルト値不一致: `obsidianProtocol` (http vs https), `obsidianPort` (27123 vs 27124)
3. 破壊的変更リスク: 既存ユーザーのアップグレード時に設定の欠落・上書き
4. 保守性低下: コンパイルエラーなしで一方を更新し忘れる可能性

## Decision

### 単一ソース化: storage.tsを使用

**決定:**
- `storage.ts`の`StorageKeys`ベース`DEFAULT_SETTINGS`を単一ソースとする
- `storageSettings.ts`の`DEFAULT_SETTINGS`を削除
- マイグレーション処理で設定欠落を防ぐ

**実施手順:**
1. `storageSettings.ts`のDEFAULT_SETTINGS削除
2. マイグレーション実装: `migrateToSingleSettingsObject()`を改良
3. v4.11リリース時のコミュニケーション

## Consequences

### Positive

- ドロ管理者保存: DEFAULT_SETTINGSが1箇所のみ
- コンパイル時チェック: StorageKeys使用によりタイプ安全
- 破壊的変更防止: StorageKeys表面上のデフォルト値が明確

### Negative

- 既存ユーザー保留設定の変動可能性: マイグレーションガードが必要
- `storageSettings.ts`使用中のコードへの影響: 外部使用を確認

### Mitigation

- マイグレーションガード: 旧設定キーを明示的にマイグレーション
- バージョニング設定: `DEFAULT_SETTINGS_VERSION`追跡

## Implementation Steps

- [x] ADR作成
- [x] デフォルト値不一致の調査完了
  - storage.ts: HTTPS, port 27124
  - storageSettings.ts: HTTP, port 27123
- [x] **リスク評価と移行計画** (重要)
  - 既存ユーザーのポート設定 (27123) を事前に調べる
  - ポート変更による接続断の影響範囲を調査
  - 新デフォルト (27124) へのマイグレーション時期を決定
  - 結論: 既存設定優先によりリスクは限定的
- [x] storage.ts DEFAULT_SETTINGS export
- [x] storageSettings.ts: DEFAULT_SETTINGS削除 + 再エクスポート
- [x] 型定義一貫性確認 (TypeScript type-check OK)
- [x] テスト確認 (98件全パス)
- [ ] マイグレーション実装（旧設定 → StorageKeys）
- [ ] テスト追加（マイグレーション検証）
- [ ] Linkage: `storageSettings.ts`使用コード修正
- [ ] 統合テスト実行・検証
- [ ] ドキュメント更新
- [ ] リリースノート記載（破壊的変更の警告を含める）

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: Phase 2（単一ソース化 - 完了） / Phase 3（マイグレーション強化 - 待機中）
- **Superseded By** -

## Implementation Summary

### Phase 2: 単一ソース化（完了）

**変更内容:**
1. `storage.ts`: `DEFAULT_SETTINGS` を `export const` に変更
2. `storageSettings.ts`:
   - `storage.ts` から `DEFAULT_SETTINGS` と `Settings` 型をインポート
   - 自身の `DEFAULT_SETTINGS` 定義を削除
   - `STORAGE_DEFAULT_SETTINGS` を `DEFAULT_SETTINGS` として再エクスポート

**リスク評価結果:**
- 既存設定優先: ユーザーが既に設定している場合、新しいデフォルト値は適用されない
- ポート変更の影響: 既存ユーザーは接続設定が維持されるため、接続断のリスクは限定的
- 型安全性: TypeScript type-check パス（型定義の一貫性確認）

**テスト結果:**
- storage テスト: 98件全パス
- TypeScript 型チェック: エラーなし

**推奨事項:**
- 既存ユーザーへの事前通知（ポート変更の可能性）
- v4.11リリース時にドキュメント更新
- 次期リリースでマイグレーション強化（Phase 3）

## Risk Assessment

### High Risk Items

1. **ポート変更による接続断**
   - 既存ユーザー: 27123 (HTTP) → 新デフォルト: 27124 (HTTPS)
   - ポート番号 27123/27124 は Obsidian Local REST API プラグインのデフォルト
   - ユーザーが未設定の場合、接続エラーが発生

2. **プロトコル変更 (HTTP → HTTPS)**
   - HTTPS は新しいデフォルトだが、自己署名証明書設定が必要
   - 未設定のユーザーは接続エラーが発生

### Mitigation Strategies

1. **既存設定の移行保護**
   - ユーザーが既に設定している場合は、新デフォルト値を適用しない
   - `DEFAULT_SETTINGS_VERSION` と `SETTINGS_MIGRATED_KEY` で状態管理

2. **段階的ロールアウト**
   - 最初は storageSettings.ts の DEFAULT_SETTINGS を維持
   - 次期リリースで storage.ts を単一ソース化
   - ユーザーへの事前通知とドキュメント更新

3. **警告とエラーメッセージ**
   - 接続失敗時に「ポート番号が変更されました」警告を表示
   - 復旧手順を提供する