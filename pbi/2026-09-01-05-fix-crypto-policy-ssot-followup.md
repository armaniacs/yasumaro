# PBI: 暗号ポリシー SSOT の残余 — log export/import 署名 と get-or-create 排他

## ユーザーストーリー
利用者として、ブラウジングログのエクスポート/インポートが、設定エクスポートと同じ HMAC 署名で改竄検知されるようにしたい。なぜなら現在 log export ファイルは無署名で、細工したログ JSON をそのまま SQLite に取り込めてしまうから（VULN-035）。あわせて `hmacKeyStore` / `confirmTokenManager` の鍵・トークン生成が未排他で、並行呼び出しが分岐した鍵/トークンを生む余地が残っている（VULN-039 の残り）。

## 背景

archived PBI `2026-08-29-12-fix-crypto-policy-ssot.md`（VULN-010/034/035/037/038/039/040/052）の効果確認（2026-09-01、`autonomous-task-closer` の DoD 乖離監査）で、**中核は実装済みだが受け入れ基準の 2 項目が未達のまま archived 入り**していたことが判明した。

### 実装済み（archived PBI で達成）
- `src/utils/crypto/cryptoParams.ts` に暗号パラメータ SSOT（`PBKDF2_ITERATIONS: 600_000` / `LEGACY_PBKDF2_ITERATIONS: 100_000` / strict パスワードポリシー validator）。`primitives.ts` / `envelope.ts` / `hmacKeyStore.ts` / `masterPassword.ts` / `settingsExportImport.ts` が参照
- KEK の `chrome.storage.session` 化（`hmacKeyStore.ts:137`、local は読み取り後方互換のみ）
- `RateLimitService` の FAILED_ATTEMPTS / LOCKED_UNTIL を `storage.local` 永続化、成功時のみリセット
- `masterPassword.validatePasswordRequirements` が `cryptoParams.validatePasswordPolicy` に一本化（弱い length≥8 実装は削除）
- settings 暗号エクスポート version:2（ciphertext HMAC、復号前検証、v1 後方互換）
- `encryptionSession.ts` の `encryptionKeyMutex` パターン

### 未達（本 PBI のスコープ）
1. **log export/import の HMAC 署名（archived PBI の受け入れ基準 L70 / VULN-035）**
   - `src/dashboard/exportLogsService.ts` の `exportJson()` が生成する `{ version: 1, table: 'browsing_logs', rows }` に署名がない
   - `src/dashboard/importLogsService.ts` の `importFromJson()` に署名ゲートがない（`validateRow` の 9 フィールド検証のみ）
2. **`hmacKeyStore` / `confirmTokenManager` の get-or-create 未排他（archived PBI の受け入れ基準 L61 / VULN-039 の残り）**
   - `src/utils/crypto/hmacKeyStore.ts:215` `getOrCreateWrappedHmacKey` が Mutex なし
   - `src/background/confirmTokenManager.ts:62` `generateToken()` → set が排他なし

## 受け入れ基準

### log export/import 署名
- [ ] `exportLogsService.exportJson()` が、`settingsExportImport.exportSettings()` と同じパターンで `getOrCreateHmacSecret()` + `computeHMAC(secret, json)` の署名を付与し、`{ version, table, rows, signature }` を書き出す
- [ ] `importLogsService.importFromJson()` が、パース後・`importLogs` 呼び出し前に `signature` を検証する。`signature` 欠落は拒否（`constantTimeCompare`）。verification 失敗も無条件で拒否
- [ ] 署名対象バイト列を export/import で厳密一致させ（`signature` を除いた `JSON.stringify(data, null, 2)`）、正当ファイルの round-trip がテストで壊れないことを保証
- [ ] 旧無署名 log ファイルの扱いを決定（移行期間フラグ or 即時拒否）。settings import が「即時拒否＋i18n 警告」を採っているため揃えるのが既定案
- [ ] `CHANGELOG.md` と `public/PRIVACY.md` + `docs/PRIVACY.md`（同一に保つ）を更新

### get-or-create 排他
- [ ] `hmacKeyStore.getOrCreateWrappedHmacKey` が `Mutex`（`src/background/Mutex.ts` 相当、または `encryptionSession` の `encryptionKeyMutex` パターン）で generate+wrap+persist+cache を 1 locked section にする
- [ ] `confirmTokenManager` のトークン生成→保存を排他化する
- [ ] 並行 2 コンテキスト呼び出しで単一の鍵/トークンが生成されることを統合テストで固定

### 共通
- [ ] `npm run type-check` / `npm run lint` / `npm run validate` が成功する
- [ ] VulnHunter 再検証: VULN-035（log 署名）と VULN-039（get-or-create 排他）の再現テストが失敗する

## テスト戦略

### 単体
- 新規 `src/dashboard/__tests__/exportImportLogsSignature.test.ts` — export→import の round-trip / 署名欠落拒否 / 改竄検知
- 更新 `src/dashboard/__tests__/importLogsService.test.ts` / `importLogsService-validateRow.test.ts` — 署名フィクスチャ追加

### 統合
- `hmacKeyStore` × 2 コンテキスト同時 `getOrCreateWrappedHmacKey` → 単一鍵
- `confirmTokenManager` × 並行 `issue` → 単一トークン

## 実装アプローチ
- Outside-In: 署名 round-trip テスト（Red）→ export に署名付与 → import に署名ゲート → 旧形式の扱い決定
- `settingsExportImport.ts:310-352`（`exportSettings`）と `:440-490`（`importSettings`）を参照実装とする。secret 取得は `getOrCreateHmacSecret`（`encryptionSession.ts`）

## 見積もり
3pt — 署名パターンは settings 側に実在するため移植中心。get-or-create 排他は Mutex 適用 2 箇所 + 並行テスト

## Definition of Done
- [ ] 全受け入れ基準を満たす
- [ ] log export/import の署名 round-trip テストがパス
- [ ] get-or-create 排他の並行テストがパス
- [ ] `npm run validate` green
- [ ] archived PBI `2026-08-29-12` の該当項目が本 PBI で解消されたことを追記

## 技術的考慮事項
- 行番号は 2026-09-01 時点。着手時にシンボルで再確認
- log export の JSON は現状 `version: 1`。署名導入で `version: 2` に上げるか、`signature` の有無で判定するかを決める（settings 側は `signature` フィールドの有無で分岐）
- `hmacKeyStore` は content/offscreen からも呼ばれうるため、`Mutex` の import 経路が層を跨がないか確認（`encryptionSession` の mutex は utils 内で完結）
