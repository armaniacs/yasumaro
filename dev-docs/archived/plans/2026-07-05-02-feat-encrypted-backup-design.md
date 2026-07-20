# Design: 暗号化バックアップ（履歴 + 設定）

- 元PBI: [2026-07-04-10-feat-encrypted-backup.md](2026-07-04-10-feat-encrypted-backup.md)
- 関連: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状

調査の結果、以下がすでに実装済みだった。

- **設定の暗号化エクスポート/インポート**: `src/utils/settingsExportImport.ts` の `exportEncryptedSettings` / `importEncryptedSettings`。マスターパスワード機能と連携済み。
- **暗号化封筒**: `src/utils/crypto.ts` の `encryptEnvelope` / `decryptEnvelope`（`EncryptionEnvelope`, version 2, PBKDF2 600,000回 + AES-GCM）。
- **履歴エクスポート**: `src/dashboard/exportLogsService.ts` に `exportJson` / `exportCsv` / `exportDb` があるが、いずれも平文のみ。`exportJson`/`exportCsv` は `queryLogs({ limit: 10000 })` で件数上限あり。`exportDb()` は `backupDb()` を使い SQLite ファイル全体をバイナリ取得（件数上限なし）。
- **履歴の復元（インポート）**: 行単位の `importLogs` はあるが、SQLite バイナリファイル全体を書き戻す機能は存在しない。

このPBIのスコープは「履歴 + 設定を1つの暗号化ファイルに統合してエクスポート/インポートできるようにする」こと。既存の設定側暗号化の仕組みを拡張し、履歴側は新規にバイナリ丸ごと方式の暗号化・復元を実装する。

## アーキテクチャ

```
[Dashboard UI]
  「暗号化バックアップ」ボタン（新規、既存の設定/履歴エクスポートとは別ボタン）
    ├─ Export: パスフレーズ入力 → ペイロード構築 → encryptEnvelope → 単一ファイルダウンロード
    └─ Import: ファイル選択 → パスフレーズ入力 → decryptEnvelope → 検証 → DB/設定復元

[新規モジュール] src/dashboard/encryptedBackupService.ts
  - buildBackupPayload(): Promise<{ version, exportedAt, settings, historyDbBase64 }>
  - exportEncryptedBackup(password): Promise<EncryptionEnvelope>
  - applyBackupPayload(payload): Promise<void>  // 検証込みの復元
  - importEncryptedBackup(envelope, password): Promise<void>

[background 側] 新規メッセージハンドラ（dashboardSqliteHandlers.ts 拡張）
  - RESTORE_SQLITE_DB: 受け取ったバイナリを一時OPFSファイルに書き込み → 開けるか検証 → 本番ファイルとreplace
```

## データフロー

### エクスポート

1. `getSettings()` で現行設定を取得
2. `backupDb()` で SQLite バイナリ（`Uint8Array`）を取得
3. バイナリを Base64 化し、以下の平文ペイロードを構築:
   ```json
   {
     "version": 1,
     "exportedAt": "<ISO8601>",
     "settings": { ...Settings },
     "historyDbBase64": "<base64>"
   }
   ```
4. `JSON.stringify` した文字列を `encryptEnvelope(json, password)` に渡し `EncryptionEnvelope` を得る
5. `EncryptionEnvelope` を JSON ファイルとしてダウンロード（例: `yasumaro-backup-<date>.encrypted.json`）

### インポート

1. ファイル読み込み → JSON parse → `isEncryptionEnvelope()` で構造検証
2. `decryptEnvelope(envelope, password)` で復号
   - パスフレーズ誤りの場合 AES-GCM の認証タグ検証に失敗し例外が発生 → エラー表示、既存データは無変更
3. 復号後の JSON を parse し、ペイロードの `version` フィールドを検証（非対応バージョンは復元せず拒否）
4. `historyDbBase64` を Base64 デコードして `Uint8Array` に戻す
5. background に `RESTORE_SQLITE_DB` メッセージでバイナリを送信
   - 一時ファイル（例: `history-restore-tmp.sqlite3`）に OPFS で書き込み
   - 一時ファイルを SQLite として開けるか検証（マジックヘッダ確認 + 簡易クエリ実行）
   - 検証OKなら本番ファイルと置換。検証NGなら一時ファイルを破棄しエラーを返す（既存DBは無傷）
6. DB置換が成功した後にのみ `saveSettings()` で設定を復元
7. 復元完了後、ダッシュボードの各パネルをリロード

## エラーハンドリング

| ケース | 挙動 |
|---|---|
| 誤パスフレーズ | `decryptEnvelope` が例外 → エラーメッセージ表示、既存データ変更なし |
| ファイル破損（JSON parse失敗） | インポート前に検出しエラー表示 |
| `EncryptionEnvelope` 構造不正 | `isEncryptionEnvelope()` で弾く |
| ペイロードバージョン不一致 | 復元前に拒否、エラー表示 |
| 復元用DBバイナリが壊れている | 一時ファイルでの開封検証に失敗 → 本番ファイル未変更、エラー表示 |

## UI

- ダッシュボードの既存エクスポート/インポート導線とは別に「暗号化バックアップ」セクションを新設
- パスフレーズ入力は常時必須（マスターパスワード機能の有効/無効に関係なく、このバックアップ機能専用のパスフレーズ入力を都度求める）
- エクスポート: パスフレーズ入力モーダル → ダウンロード
- インポート: ファイル選択 → パスフレーズ入力モーダル → 復元確認 → 実行

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `encryptedBackupService.ts`: ペイロード構築、暗号化/復号ラウンドトリップ
- 誤パスフレーズでの復号失敗
- バージョン不一致ペイロードの拒否
- 破損データ（JSON壊れ、envelope構造不正）の拒否
- DB一時領域検証ロジック（開封失敗時に本番ファイル不変であること）

### 統合テスト
- エクスポート → インポートで設定・履歴が完全一致
- 既存 `exportEncryptedSettings`/`importEncryptedSettings` との非干渉（既存機能に影響を与えない）

### E2Eテスト
- ダッシュボードで暗号化バックアップ作成 → 別状態でインポート → 履歴・設定の復元一致
- 誤パスフレーズでインポートが失敗し、既存の履歴・設定が変化しないこと

## 実装アプローチ

Outside-In / Red-Green-Refactor。暗号化ラウンドトリップ（ペイロード構築 + encryptEnvelope/decryptEnvelope）の単体テストから着手し、その後DB一時領域置換ロジック、最後にUI結線の順で進める。

## 技術的考慮事項

- 依存: なし（既存の `crypto.ts`, `settingsExportImport.ts`, `exportLogsService.ts`, `dashboardSqliteService.ts` を再利用・拡張）
- Base64化によりファイルサイズは元DBの約33%増。大容量履歴の場合、将来的にストリーミング化の検討余地はあるが、本PBIのスコープ外とする
- OPFSへの一時ファイル書き込み・atomic置換の実装は `sqliteClient.ts` 内の既存OPFS操作パターンに準拠する

## スコープ外（YAGNI）

- 部分復元（履歴のみ/設定のみを選択して復元する機能）は本PBIでは対象外。全体を一括で復元する
- ストリーミング処理による大容量最適化は将来課題とし、今回は実装しない
