# マスターパスワード設定撤回時のデータクリーンアップ

## Context

マスターパスワードを無効化した際に暗号化されたAPIキーデータが残存する可能性があります。

**現状:**
- マスターパスワード機能が実装されているが、無効化時のデータクリーンアップが不完全
- 設定撤回時に暗号化されたAPIキーがストレージから削除されない
- 古い暗号データが残存し、セキュリティリスクになる

**レビュー指摘:**
- **指摘者**: Compliance & Privacy Guard
- **場所**: `src/utils/storage.ts`
- **優先度**: Medium
- **影響**: マスターパスワードを無効化した際に暗号化されたAPIキーデータが残存する可能性

## Decision

### 実装方針

1. **設定撤回時のクリーンアップ**: マスターパスワード無効化時に暗号化データを削除
2. **復号済みデータも削除**: 平文/復号済みデータも同時に削除
3. **ユーザー通知**: クリーンアップの実行をユーザーに通知
4. **バックアップオプション**: 重要なデータのバックアップを提供

### 実装フェーズ

#### Phase 1: クリーンアップロジック実装
- マスターパスワード無効化時のクリーンアップ関数実装
- APIキー、その他の暗号化データの削除

#### Phase 2: 通知表示
- クリーンアップ実行の確認ダイアログ表示
- クリーンアップ完了通知表示

#### Phase 3: テストと検証
- クリーンアップテスト追加
- ユーザー体験テスト

## Consequences

### Positive

- データ残存によるセキュリティリスクを排除
- ユーザーの期待に合う挙動（設定撤回 = データ削除）
- コンプライアンス要件の満たしやすさ向上

### Negative

- 誤操作によるデータ損失リスク
- クリーンアップ所要時間によるUX影響

### Mitigation

- 認証済みユーザーのみ操作可能（既存実装）
- 重要なデータのバックアップオプション提供（将来実装）
- 段階的なクリーンアップ実装（初期はAPIキーのみ）

## Implementation Steps

### Phase 1: クリーンアップロジック（完了）
- [x] ADR作成
- [x] APIキー暗号化データ削除実装
- [x] popup.tsのマスターパスワード無効化処理拡張

**実装内容 (popup.ts:698-720):**
```typescript
showPasswordAuthModal('export', async () => {
    // Remove master password storage
    await chrome.storage.local.remove([
        'master_password_enabled',
        'master_password_salt',
        'master_password_hash'
    ]);

    // Reset API keys to default (empty) values to clear encrypted data
    const settings = await getSettings();
    const apiKeysToRemove = ['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key', 'provider_api_key'];
    for (const key of apiKeysToRemove) {
        if (key in settings) {
            settings[key as keyof Settings] = '';
        }
    }
    await saveSettings(settings);

    masterPasswordEnabled.checked = false;
    masterPasswordOptions.classList.add('hidden');
    showStatus('status', getMessage('passwordRemoved') || 'Master password and encrypted data removed.', 'success');
});
```

### Phase 2: 通知表示（将来実装予定・現スコープ外）
- [ ] 確認ダイアログ実装（現状: 認証後に直接削除を実行、削除前の確認ステップなし）
- [ ] 完了通知実装（現状: showStatus による成功メッセージのみ）

### Phase 3: テストと検証（将来実装予定・現スコープ外）
- [ ] ユニットテスト実装
- [ ] ユーザー体験テスト

## Security Considerations

### 既存暗号データの扱い

- マスターパスワード無効化時: 暗号化データを空文字列で上書き
- 復号済みデータ: 同時に削除される（Settings再セットによる）
- デフォルト設定にリセット: 空文字列で初期化

### バックアップオプション

- ユーザーが明示的に許可した場合に限りバックアップ
- バックアップは一時的なもの（次回ログイン時に削除）

## Status

- **Proposed**: 2026-03-24
- **Approved**: 2026-03-24
- **Implemented**: Phase 1（クリーンアップロジック実装完了）
- **Superseded By** -