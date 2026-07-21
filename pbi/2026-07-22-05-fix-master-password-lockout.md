# PBI: マスターパスワード認証試行回数制限の統一

## ユーザーストーリー
拡張機能の利用者として、マスターパスワードで保護されたデータ（暗号化されたAPIキー等）に対して、ポップアップからでもダッシュボードからでも、総当たり攻撃に対する同じレベルの防御（試行回数制限・ロックアウト）が適用されることを望む。なぜなら、既にポップアップ側には `src/utils/rateLimiter.ts` という実装済みの防御機構があるにもかかわらず、ダッシュボード側の複数の操作（パスワード変更・バックアップのエクスポート/インポート）や `unlockWithPassword()` の内部呼び出し経路がこの機構でガードされておらず、片方だけ守られている状態はセキュリティ上一貫性を欠くためである。

## ビジネス価値
- **セキュリティ**: ローカル/プロファイルアクセスを持つ攻撃者による総当たり攻撃のコストを、PBKDF2の計算コストのみから「ロックアウト待機時間」まで引き上げる
- **一貫性**: 既に実装済みで実績のある `rateLimiter.ts` の仕組みを、抜け漏れなく全ての認証経路に適用する（車輪の再発明をしない）

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-018 | CWE-307 | Low | `src/utils/storage/encryptionSession.ts` の `unlockWithPassword()` に試行回数カウンタ・遅延・ロックアウトが一切無い | `poc/VULN-018_no_lockout_unlock_with_password.md` | `exploit_tests/test_vuln_018_no_unlock_lockout.test.ts` |
| VULN-021 | CWE-307 | Low | `src/dashboard/masterPassword.ts` の `authenticatePassword()`（パスワード変更・暗号化バックアップのエクスポート/インポート・設定エクスポート/インポートをゲート）が、ポップアップ側 `src/popup/masterPasswordUi.ts` と同じ `verifyMasterPassword()` を呼びながら `checkRateLimit()`/`recordFailedAttempt()`/`resetFailedAttempts()` を一切呼んでいない（Phase 3dスイープで発見） | `poc/VULN-021_dashboard_password_auth_modal_no_lockout.md` | `exploit_tests/test_vuln_021_dashboard_password_auth_no_lockout.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: ダッシュボードのパスワード認証モーダルで試行回数制限が働く（VULN-021）
  Given 利用者（またはローカルアクセスを持つ第三者）がダッシュボードの「マスターパスワード変更」等の操作でパスワード認証モーダルを開いている
  When 誤ったパスワードを rateLimiter.ts の定める上限回数（5回/5分）連続して入力する
  Then 6回目以降の試行は、実際のパスワード検証を行う前にロックアウト状態として拒否される
  And ロックアウト残り時間が利用者に明示される

Scenario: unlockWithPassword() 単体でも試行回数制限が働く（VULN-018）
  Given 何らかの経路（ポップアップ以外を含む）から unlockWithPassword() が直接繰り返し呼ばれている
  When 誤ったパスワードでの試行が上限回数を超える
  Then それ以降の試行は PBKDF2 検証を実行する前に拒否される

Scenario: 正しいパスワードでの認証は制限の影響を受けない（回帰防止）
  Given 利用者が正しいマスターパスワードを1回目の試行で入力する
  When ダッシュボードのパスワード認証モーダル、またはポップアップのアンロック画面から認証する
  Then 通常通り即座に認証が成功し、試行回数カウンタはリセットされる
```

## 受け入れ基準
- [ ] `src/dashboard/masterPassword.ts` の `authenticatePassword()` が、`src/utils/rateLimiter.ts` の `checkRateLimit()`/`recordFailedAttempt()`/`resetFailedAttempts()` を、`src/popup/masterPasswordUi.ts` と同じ手順で呼び出す
- [ ] `src/utils/storage/encryptionSession.ts` の `unlockWithPassword()` に、失敗試行カウンタと最終試行タイムスタンプを `chrome.storage.local` に永続化する仕組みが追加される
- [ ] 閾値・ロックアウト時間は既存の `rateLimiter.ts` の定数（`RATE_LIMIT_ATTEMPTS = 5`, `LOCKOUT_DURATION_MS = 30分`）と一致させる（新しい閾値を独自に定義しない）
- [ ] 成功時にカウンタがリセットされる
- [ ] ダッシュボードの4つの呼び出し元（`changeMasterPasswordBtn`, `encryptedBackupPanel.ts`のエクスポート/インポート, `exportImport.ts`の設定エクスポート/インポート）全てが同じレート制限の恩恵を受ける

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意）Playwrightでダッシュボードのパスワード認証モーダルに6回連続で誤ったパスワードを入力し、ロックアウトメッセージが表示されることを確認

### 統合テスト
- [ ] `src/dashboard/__tests__/masterPassword.test.ts`（既存）に、`authenticatePassword()` がレート制限違反時に `verifyMasterPassword()` を呼ばないことを確認する統合テストを追加

### 単体テスト
- [ ] `src/utils/storage/__tests__/encryptionSession.test.ts`（新規または既存に追記）に、`unlockWithPassword()` の試行回数境界値テスト（5回目まで許可、6回目で拒否）を追加
- [ ] 既存の `src/popup/__tests__/masterPasswordUi.test.ts` 相当のテストパターンを参考に、ダッシュボード側にも同等のテストケースを追加

## 実装アプローチ
- **Outside-In**: ポップアップ側の既存実装（`masterPasswordUi.ts` + `rateLimiter.ts`）を「正解」として参照しながら、ダッシュボード側・`encryptionSession.ts`内部呼び出し側に同じパターンを移植する
- **Red-Green-Refactor**: VULN-018（`encryptionSession.ts`、より基盤に近い）→ VULN-021（`masterPassword.ts`、UI層）の順で進めると、後者が前者の仕組みを再利用しやすい

## 見積もり
3pt（既存の`rateLimiter.ts`という実績ある実装を移植するだけなので、新規設計は不要）

## 技術的考慮事項
- `rateLimiter.ts`が既にプロジェクトに存在し実績があるため、新しいレート制限アルゴリズムを設計する必要は無い。既存のインターフェースをそのまま呼び出すだけで完結するはずである
- `unlockWithPassword()`は`changeMasterPassword`からも内部的に呼ばれる（`encryptionSession.ts:277,286`）。この経路は既にポップアップの認証モーダルを通過した後に呼ばれるため、二重にロックアウトがかかることで正当な操作が阻害されないか確認する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下が該当することを確認済み）
```bash
grep -n "async function authenticatePassword\|verifyMasterPassword" src/dashboard/masterPassword.ts
grep -n "checkRateLimit\|recordFailedAttempt\|resetFailedAttempts" src/popup/masterPasswordUi.ts src/utils/rateLimiter.ts
grep -n "export async function unlockWithPassword" src/utils/storage/encryptionSession.ts
```

### 実装手順
1. `src/dashboard/masterPassword.ts` の `authenticatePassword()` に、`src/utils/rateLimiter.ts` から `checkRateLimit`/`recordFailedAttempt`/`resetFailedAttempts` をインポートし、`masterPasswordUi.ts:194,210,217` と同じ順序で呼び出しを追加する
2. `src/utils/storage/encryptionSession.ts` の `unlockWithPassword()` 冒頭に `checkRateLimit()` 相当の呼び出しを追加し、失敗時に `recordFailedAttempt()`、成功時に `resetFailedAttempts()` を呼ぶ
3. `changeMasterPassword`（`encryptionSession.ts:277,286`）からの内部呼び出しが二重ロックアウトを引き起こさないか、呼び出し元で既にレート制限済みであることを踏まえて設計する（必要なら内部呼び出し用の別引数/フラグを検討）

### 落とし穴
- `rateLimiter.ts`のキー（レート制限の識別子）が「拡張機能全体で1つ」なのか「呼び出し元ごと」なのかを確認せずに移植すると、ダッシュボードとポップアップで意図せず同じカウンタを共有してしまう可能性がある。既存実装のキー設計を必ず確認すること
- `unlockWithPassword()`に直接レート制限を組み込むと、`changeMasterPassword`経由の呼び出し（既にUI層でレート制限済み）で二重にカウントされ、正当な操作が誤ってロックアウトされる可能性がある。呼び出し階層を整理してから実装すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `exploit_tests/test_vuln_018_no_unlock_lockout.test.ts`, `test_vuln_021_dashboard_password_auth_no_lockout.test.ts` の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する
