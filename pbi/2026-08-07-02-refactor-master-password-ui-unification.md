# PBI: マスターパスワードUIのpopup/dashboard間重複を統合する

**作成日**: 2026-08-07
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（UI構造変更。検証は手動必須）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `popup/masterPasswordUi.ts`（350行）と `dashboard/masterPassword.ts`（279行）がほぼ同一のマスターパスワードモーダル実装を含むことが発見された。

### 重複箇所（ほぼverbatim）

| 関数 | 一致度 |
|------|--------|
| `updatePasswordStrength()` | Verbatim（パスワード強度バー更新ロジック） |
| `showPasswordModal()` | 構造同一（title/descのi18enキー設定、入力フィールドリセット） |
| `savePassword()` | 構造同一（要件検証 → パスワード一致検証 → `setMasterPassword` → ステータス表示） |
| `showPasswordAuthModal()` | 構造同一（モーダル表示、入力フィールドリセット） |
| `authenticatePassword()` | 構造同一（レート制限 → `verifyMasterPassword` → `resetFailedAttempts`/`recordFailedAttempt`） |
| `loadMasterPasswordSettings()` | 構造同一（`isMasterPasswordSet` → UI表示切替） |

### 主な差異

| 項目 | popup | dashboard |
|------|-------|-----------|
| モーダル表示 | `<dialog>.showModal()` | div + `focusTrapManager` + CSS classes |
| changeモード | 確認フィールド表示 | 確認フィールドトグル + changeモード状態管理 |
| 無効化時 | `confirm()` + APIキーワイプ | なし |

### 共有ユーティリティ

両方とも同じモジュールからインポートしている:
- `setMasterPassword`, `verifyMasterPassword`, `calculatePasswordStrength`, `validatePasswordRequirements`, `validatePasswordMatch`
- `checkRateLimit`, `recordFailedAttempt`, `resetFailedAttempts`
- `getMessage` (i18n)

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/popup/masterPasswordUi.ts src/dashboard/masterPassword.ts
diff <(grep -E "function|const|let|import" src/popup/masterPasswordUi.ts) <(grep -E "function|const|let|import" src/dashboard/masterPassword.ts)
```

## 受け入れ基準（BDD）

```gherkin
Scenario: パスワード強度インジケータが共有ロジックで動作する
  Given popupまたはdashboardのマスターパスワードモーダル
  When パスワードを入力する
  Then ストロングバーとテキストが正しく更新される

Scenario: パスワード設定フローが共有ロジックで動作する
  Given マスターパスワード未設定の状態
  When パスワードを設定する
  Then `setMasterPassword` が呼ばれ、モーダルが閉じられる

Scenario: パスワード認証フローが共有ロジックで動作する
  Given マスターパスワード設定済みの状態
  When 正しいパスワードを入力して認証する
  Then `verifyMasterPassword` が呼ばれ、成功する

Scenario: popup固有の動作（ダイアログAPI、APIキーワイプ）に回帰がない
  Given popupのマスターパスワードUI
  When 既存のテストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `src/utils/masterPasswordUiCore.ts` に共有ロジック（`updatePasswordStrength`, `handleSavePassword`, `handleAuthenticatePassword`, `loadSettings`）を抽出
- [ ] 各UI（popup, dashboard）はDOM操作とモーダル表示の差異分のみを担当する薄いアダプターになる
- [ ] popupの `<dialog>` API 使用と dashboardの `focusTrapManager` 使用は各々維持
- [ ] popupの `confirm()` + APIキーワイプ機能はpopupアダプターに残す
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- 抽出した `masterPasswordUiCore.ts` の各関数の単体テストを追加
- パスワード要件検証、強度計算、レート制限ロジックの検証

### 手動テスト
- popup: マスターパスワードの設定 → 変更 → 無効化フロー
- dashboard: マスターパスワードの設定 → 変更フロー
- 認証モーダルの動作（レート制限含む）

## 実装アプローチ
- 共有コアモジュール作成 → 各UIを薄いラッパーにリファクタ
- DOM操作は各UIに委譲（コアはDOM依存なし）
- 段階的移行: まず共有関数を抽出 → 次にpopupを差し替え → 最後にdashboard

## 見積もり
2pt（コア抽出 + 2UIのリファクタ + 手動テスト）

## 技術的考慮事項
- 依存: `src/popup/masterPasswordUi.ts`, `src/dashboard/masterPassword.ts`, `src/utils/masterPassword.js`, `src/utils/rateLimiter.js`
- 既存の `src/utils/masterPassword.ts`（パスワード検証ロジック）と `src/utils/masterPasswordUiCore.ts`（UIロジック）は名前が似ているが別物。命名に注意
- テスタビリティ: DOM操作はコアから分離し、テスト容易性を維持

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 1）
- 対象ファイル: `src/popup/masterPasswordUi.ts`, `src/dashboard/masterPassword.ts`
