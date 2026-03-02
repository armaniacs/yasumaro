# ADR: HMAC署名検証失敗時のユーザー確認によるインポート許可

## ステータス
採用済み

## 日付
2026-03-03

## 作成者
技術決定

## コンテキスト

### 問題の背景

設定ファイルの暗号化エクスポート機能はHMAC-SHA256署名を使用してデータの整合性を保護しています。しかし、HMACシークレットは `chrome.storage.local` に保存されており、以下の状況で失われる可能性があります：

- Chrome拡張機能の更新またはバージョン変更
- 拡張機能の再ロード（開発モードの場合）
- ブラウザプロファイルのダッシュボードで拡張機能データの手動消去
- 新しいブラウザプロファイルまたはマシンへの拡張機能のインストール

### 現在の状況

`src/utils/settingsExportImport.ts` において、HMAC署名検証失敗時に確認ダイアログを表示し、ユーザーが明示的に同意した場合にインポートを継続する実装がなされています。

### 影響を受けるステークホルダー

- **エンドユーザー**: 自分の設定バックアップを復元する能力を必要としている
- **管理者/セキュリティ監査**: 将来の侵入検知フローで署名検証を使用する可能性がある
- **開発者**: テスト環境での頻繁な拡張機能再ロードを必要としている

## 関連するADR

- [0001-api-key-security-policy.md](./0001-api-key-security-policy.md) - APIキーはエクスポートに含まれない
- [2026-03-02-notification-id-security-and-log-privacy.md](./2026-03-02-notification-id-security-and-log-privacy.md) - HMAC署名による通知ID保護

## 決定事項

**HMAC署名検証失敗時にユーザーの明示的な確認を要求し、インポートを許可する機能的バイパスを維持する**

### 理由

1. **ユーザー主権の維持**: ユーザーは自分のデータを管理し、HMACシークレットの変更後に設定を復元する権利を持つ必要がある
2. **自己復旧能力**: 拡張機能の更新や環境変更後にバックアップから復元する手段が必要
3. **レガシーファイルの互換性**: すべての状況で署名検証を厳密にブロックすると、正当なユーザーのバックアップが使用不能になる

### 実装

```typescript
// src/utils/settingsExportImport.ts:178-195
if (encryptedData.hmac !== computedHmac) {
  await logError(
    'HMAC verification failed',
    {},
    ErrorCode.SETTINGS_SIGNATURE_FAILURE,
    'settingsExportImport.ts'
  );

  // ユーザーに明確な警告と確認を要求
  const forceImport = confirm(chrome.i18n.getMessage('hmacVerificationFailedConfirm'));
  if (!forceImport) {
    return null;
  }

  // 強制インポートをログ記録（監査用）
  await logWarn(
    'Force importing encrypted settings despite HMAC verification failure',
    {},
    ErrorCode.SETTINGS_SIGNATURE_FAILURE,
    'settingsExportImport.ts'
  );
}
```

### ユーザーへの通知メッセージ

**英語:**
```
Settings file signature verification failed.

Reason: HMAC secret may have changed (extension update/reload, etc.).

If this is a trusted settings file, click "OK" to force import.
If not, click "Cancel".
```

**日本語:**
```
設定ファイルの署名検証に失敗しました。

原因: HMACシークレットが変更された可能性があります（拡張機能の更新・再ロード等）。

信頼できる設定ファイルの場合は「OK」をクリックして強制インポートしてください。
信頼できない場合は「キャンセル」をクリックしてください。
```

### 緩和策

1. **エラーログ記録**: HMAC検証失敗と強制インポートが `ErrorCode.SETTINGS_SIGNATURE_FAILURE` で記録される
2. **明確な警告**: 確認ダイアログで失敗理由とリスクを説明
3. **デフォルト拒否**: 検証失敗時はデフォルトでインポートを拒否（キャンセル）
4. **APIキーの除外**: ADR-0001により、APIキーはエクスポートに含まれないため、最もセンシティブなデータは保護されている

## 結果

### メリット

- **ユーザー主権**: ユーザーは自分の設定データを完全に制御できる
- **自己復旧能力**: HMACシークレット変更後にバックアップから復元できる
- **開発体験**: テスト環境での頻繁な再ロードに対応
- **柔軟性**: 新しい環境への移行やバックアップ復元が可能

### デメリット

- **技術的バイパス可能性**: 攻撃者が悪意のあるファイルをインポートできる可能性がある（ただし、以下の緩和策によりリスクは低減）
  - ユーザーの明示的な確認が必要
  - APIキーはエクスポートに含まれない
  - すべてのイベントがログ記録される
- **誤操作リスク**: ユーザーが警告を確認せずにインポートする可能性がある

### トレードオフ

本機能は「技術的な厳密性」と「ユーザー主権・実用性」の間の意図的なトレードオフです。

HMAC署名の目的：
1. **主目的**: 不正操作の検出（検証失敗は警告として機能）
2. **副目的**: 改ざん防止（ただし、ユーザー確認でオーバーライド可能）

これから：
- 攻撃者はHMAC署名を再生成できないことを防ぐ
- 正当なユーザーは自分のデータにアクセスできる

### 影響範囲

- 影響を受けるファイル:
  - `src/utils/settingsExportImport.ts` - インポート時のHMAC検証実装
- 関連するi18nメッセージ:
  - `_locales/en/messages.json` - `hmacVerificationFailedConfirm`
  - `_locales/ja/messages.json` - `hmacVerificationFailedConfirm`

### 実装状態

- ✅ 実装済み: `src/utils/settingsExportImport.ts:178-195`
- ✅ ログ記録: `ErrorCode.SETTINGS_SIGNATURE_FAILURE`
- ✅ i18nメッセージ: 日英両言語に実装済み

## 参照

- [HMAC - OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- Checking Team レビュー結果 (v4.1.1) - CRITICAL指摘についての対応
- Chrome Extension Storage API - `chrome.storage.local` の永続性に関するドキュメント