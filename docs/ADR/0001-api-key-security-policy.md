# ADR: APIキーセキュリティポリシー

## ステータス
採用済み

## 日付
2026-03-01

## コンテキスト

ユーザー設定のエクスポート/インポート機能を実装する際、以下の課題が存在しました：

1. **セキュリティリスク**: APIキーが平文テキストでエクスポートファイルに含まれると、ファイルの誤共有や漏洩時に重大なセキュリティリスクとなる
2. **暗号化キーの管理問題**: HMAC署名キーは拡張機能の更新や再ロードによって変更される可能性があり、長期的なデータ復号の保証が困難
3. **既存データの互換性**: 過去のエクスポートファイルにAPIキーが含まれている場合の処理方法

## 関連するADR

- なし

## 決定事項

**APIキーはエクスポートされず、インポートもされない**

### ポリシー

1. **エクスポート時の除外**
   - `obsidian_api_key`、`gemini_api_key`、`openai_api_key`、`openai_2_api_key` はエクスポート前に削除される
   - エクスポートデータには `apiKeyExcluded: true` フラグが設定される
   - これは平文エクスポート (`exportSettings()`) と暗号化エクスポート (`exportEncryptedSettings()`) の両方に適用

2. **インポート時の保護**
   - APIキーが除外されたエクスポートファイルをインポートする場合、既存のAPIキーは保持される
   - インポートを使用してAPIキーを上書きすることはできない
   - APIキーの設定は、ユーザーが直接ダッシュボードで入力する必要がある

3. **暗号化APIキーの格**
   - ストレージ内のAPIキーはAES-GCMで暗号化されて格納される
   - 暗号化には拡張機能が生成するランダムソルトとシークレットが使用される

### 実装

```typescript
// エクスポート時の除外処理
function sanitizeSettingsForExport(settings: Settings): Settings {
  const sanitized = { ...settings };

  for (const field of API_KEY_FIELDS) {
    delete sanitized[field];
  }

  return sanitized;
}

// インポート時のマージ処理
async function mergeWithExistingApiKeys(importedSettings: Settings): Promise<Settings> {
  const existingSettings = await getSettings();
  const merged = { ...importedSettings };
  for (const field of API_KEY_FIELDS) {
    merged[field] = existingSettings[field];  // 既存のAPIキーを保持
  }
  return merged;
}
```

## 結果

### セキュリティ上の恩恵

1. **漏洩リスクの削減**: エクスポートファイルにAPIキーが含まれないため、ファイルの共有や誤操作による漏洩リスクが最小限に抑えられる
2. **ユーザーの安心感**: APIキーはブラウザ内でのみ保持され、外部ファイルに出力されない設計により、ユーザーの心理的安心感が向上する

### トレードオフ

- **利便性の低下**: ユーザーは別の端末でAPIキーを再入力する必要がある
- **バックアップの制限**: 完全なバックアップには手動でのAPIキー記録が必要

### ユーザーへの通知

- ダッシュボードのエクスポート機能には 「APIキーはエクスポートに含まれません」 という説明を表示
- インポート時には、「APIキーは保持され、インポートされません」 という通知を表示

### 実装コード

- `src/utils/settingsExportImport.ts`: エクスポート/インポートの実装
- `src/utils/storageSettings.ts`: `API_KEY_FIELDS` の定義