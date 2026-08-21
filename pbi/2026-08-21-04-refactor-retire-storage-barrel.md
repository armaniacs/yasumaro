# PBI: storage.ts barrel の retire — 直接 import への移行と lint seam 付与

## ユーザーストーリー
開発者として、`src/utils/storage.ts` の deprecated barrel を retire し直接 import に移行したい、なぜなら38個の re-export が0の振る舞いで50箇所の呼び出し元が「どの storage module に依存しているか」を隠し、LAYERS.md Wave 3 が @deprecated のまま停滞しているから

## 優先度
- 順位: 4 / 5
- RICEスコア: 100（Reach=300 / Impact=1 / Confidence=100% / Effort=3人週）
- 根拠: 50の production importer と全 storage 依存コードに影響。Impact 1（振る舞い変化なしだが locality と AI-navigability が向上）。Confidence 100%（grep で全 import 箇所を特定済み、4つの深い module は既に存在）。Effort 3週（50ファイルの import 置換、lint ルール追加、レビュー）。他PBIと独立だが、PBI 03（SqliteClient 深掘り）と並行すると storage 周りの変更が競合するため順序を分ける。

## ビジネス価値
- 新規開発者が `storage.ts` の 38 re-export の中から探すのではなく、所有する module（`settingsStore` / `savedUrlRepository` / `encryptionSession` / `types`）を直接見に行くようになり、誤った依存を追加しにくくなる
- AI エージェントが grep で「どのファイルが settings を触るか」を正確に追跡できる（barrel 経由では全て `storage.js` に見えるため追跡が曖昧）
- 測定: `grep -rn "from.*utils/storage\.js" src/ --include="*.ts" | grep -v storage/ | wc -l` が 50→0 になること、barrel ファイルが削除または空の re-export shim のみになること

## BDD受け入れシナリオ

```gherkin
Scenario: 直接 import で settings を取得する
  Given src/utils/storage/settingsStore.ts が getSettings / saveSettings を公開する deep module である
  When 任意の background module が getSettings を呼ぶ
  Then import は from '../../utils/storage/settingsStore.js' であり、from '../../utils/storage.js' ではない

Scenario: lint seam が barrel import を検出する
  Given eslint の no-restricted-imports ルールが storage.js barrel を禁止している
  When 新規コードで from '../utils/storage.js' を import する
  Then lint がエラー（"Use direct import from storage/* instead"）を報告し、CI が失敗する

Scenario: barrel が空になる
  Given 全50箇所の production importer が直接 import に移行した
  When src/utils/storage.ts を確認する
  Then ファイルは削除されているか、@deprecated の re-export shim のみ（新規コードからは参照されない）である

Scenario: 循環依存の例外が保護される
  Given src/utils/storage/settingsStore.ts ↔ src/utils/trustDb/trustDb.ts の循環が dynamic import で回避されている
  When barrel を削除する
  Then 循環は LAYERS.md と ADR 2026-08-20-utils-layer-circular-dependency に記録されたまま、dynamic import の形で維持される

Scenario: エラー — barrel 経由のテストが移行される
  Given 既存テストが from '../utils/storage.js' で StorageKeys を import している
  When テストを from '../utils/storage/types.js' に置換する
  Then テストは同じ StorageKeys 値でパスし、barrel 削除後も壊れない
```

## 受け入れ基準
- [ ] `grep -rn "from.*utils/storage\.js" src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test.ts" | grep -v "storage/"` のヒットが0件（production コードで barrel import が0件）
- [ ] `eslint.config.js` に `no-restricted-imports` ルール（`src/utils/storage.js` の import を禁止、message: "Use direct import from storage/*"）が追加されている
- [ ] `npm run lint` が barrel import をエラーとして検出し、`npm run type-check` が全直接 import でパスする
- [ ] `src/utils/storage.ts` が削除されているか、@deprecated re-export shim のみで新規コードから参照されない（`git log --diff-filter=D` または shim のみで確認）
- [ ] `LAYERS.md` の Barrel セクションが「retired」に更新され、移行完了が記録されている
- [ ] `npm run validate` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能をロードし、settings 保存 → 再読込 → 保存値が維持されるシナリオ（barrel 経由と直接 import で挙動が同一であること）

### 統合テスト
- `settingsStore.test.ts` / `savedUrlRepository.test.ts` / `encryptionSession.test.ts` が直接 import 越しにパスすること（barrel を経由せずに各 module が独立してテストされる）
- `createBackgroundServices` が直接 import 越しに `getSettings` / `saveSettings` を解決すること

### 単体テスト
- 各 storage module の単体テストが barrel なしで import できること（types / settingsStore / savedUrlRepository / encryptionSession それぞれ）
- eslint ルールの単体テスト（barrel import を検出し、直接 import は許容すること）

## 実装アプローチ
- **Outside-In**: まず eslint ルールを追加し、1ファイルの import を直接 import に置換して lint が通ることを確認（RED→GREEN）→ 残り49ファイルをバッチで置換 → barrel 削除で Refactor
- **Red-Green-Refactor**: バッチは 10ファイルずつに分割し、各バッチで `npm run type-check` を挟む。barrel 削除は最後に1回だけ行う

## 見積もり
3pt（要チームでの見積もり）— 50ファイルの置換は機械的だが、循環依存の例外（settingsStore ↔ trustDb）の dynamic import が壊れていないか各バッチで確認が必要

## 技術的考慮事項
- 依存関係: 他PBIと独立。PBI 03 と並行すると `storage/settingsStore.ts` 周りの変更が競合するため、PBI 03 完了後に着手するか、変更ファイルを分けて並行レビュー
- テスタビリティ: 各 storage module は `InMemory` adapter（SettingsRepository と同様）でテスト可能。barrel 経由のテストは直接 import に置換しても同じ adapter で動作
- 非機能要件: 既存ユーザーの `chrome.storage.local` のデータは影響なし（import パスの変更のみで永続化形式は変わらない）

## 実装者向け注記

### 現状コードの確認
```bash
# barrel の実態（38 re-exports, 0 behavior）
wc -l src/utils/storage.ts && grep -c "export" src/utils/storage.ts
# production での barrel import 数
grep -rn "from.*utils/storage\.js" src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test.ts" | grep -v "storage/" | wc -l
# 各 import がどの storage module に属するか
grep -rn "from.*utils/storage\.js" src/ --include="*.ts" | grep -v "__tests__" | head -20
# 直接 import に既に移行済みの数（対比）
grep -rn "from.*storage/types\|from.*storage/settingsStore\|from.*storage/savedUrlRepository" src/ --include="*.ts" | grep -v "__tests__" | wc -l
# 循環依存の例外（dynamic import で保護されていること）
grep -n "await import" src/utils/storage/settingsStore.ts src/utils/trustDb/trustDb.ts
```
未実装ではなく「移行が停滞」した状態。lint seam による強制が目的。

### 実装手順
1. `eslint.config.js` に `no-restricted-imports` ルールを追加（`src/utils/storage.js` を禁止、ただし `src/utils/storage.ts` 自身と `src/utils/storage/*` は除外）
2. 1ファイル（例: `src/background/dailyPurgeHandler.ts`）の `from '../utils/storage.js'` を `from '../utils/storage/types.js'` / `settingsStore.js` など所有 module に置換し、`npm run type-check` で確認（RED→GREEN）
3. 残り49ファイルを 10ファイルずつのバッチで置換（各バッチで `npm run type-check`）
   - `StorageKeys` → `from '../utils/storage/types.js'`
   - `getSettings` / `saveSettings` / `buildAllowedUrls` → `from '../utils/storage/settingsStore.js'`
   - `getSavedUrls*` / `SavedUrlEntry` → `from '../utils/storage/savedUrlRepository.js'`
   - `getOrCreateEncryptionKey` など → `from '../utils/storage/encryptionSession.js'`
4. テストの import も同様に置換（`src/**/__tests__` は lint ルールの除外対象だが、直接 import に揃える）
5. `src/utils/storage.ts` を削除（または @deprecated shim のみに縮小し、参照が0件であることを `grep` で確認）
6. `dev-docs/LAYERS.md` の Barrel セクションを「retired」に更新し、ADR に追記
7. `npm run validate` で全体確認

### 落とし穴
- `src/utils/storage.ts` は `StorageKeys` / `DEFAULT_SETTINGS` / `Settings` 型などを再エクスポートするため、単に `from '../utils/storage.js'` を `from '../utils/storage/types.js'` に置換すると `getSettings` が見つからない。1つのファイル内で複数の barrel import がある場合は、所有 module ごとに import を分割する必要がある（例: `types.js` と `settingsStore.js` の2行に分ける）
- `src/utils/trustDb/trustDb.ts` が `getSettings` を dynamic import で呼ぶ箇所は、barrel 削除後も `await import('../storage/settingsStore.js')` の形で維持すること。誤って static import に戻すと循環が顕在化する
- `src/background/handlers/dashboardSqlite/deps.ts` の `from '../../../utils/storage.js'` は `getSettings` のみを使うため `from '../../../utils/storage/settingsStore.js'` に置換するが、`StorageKeys` を使う箇所があれば `types.js` に分離すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（各 storage module の import パス変更でテストが壊れていないこと）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（barrel 削除、lint seam 追加）
- [ ] ドキュメント更新済み（LAYERS.md / ADR 追記）
