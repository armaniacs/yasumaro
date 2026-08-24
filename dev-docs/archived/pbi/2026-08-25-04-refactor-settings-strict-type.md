# PBI-04: Settings `index signature`撤廃 + settingsStore.legacy削除

優先度: 4位 / RICE 36.0 (Reach 10 × Impact 1.5 × Conf 60% / Effort 0.25w) — Slice A完了後に着手（依存）
種別: refactor
依存: Slice A（PBI-01）完了後
ファイル触接: `src/utils/storage/types.ts:469`, `src/utils/storage/settingsStore.legacy.ts`, `src/utils/storage/settingsStore.ts`, `eslint.config.js`
Effort: 0.25w (S)

## 背景

`Settings = Partial<StorageKeyValues> & {[key:string]:unknown}`で`settings['typo']`が型エラーにならず、`StrictSettings`は未使用。38ファイルが`settingsStore.legacy`直importで`SettingsRepository`吸収後も二重`ensureStorageQuota`債務が残る。`eslint`は`warn`で抑止力なし。

## 目的

`StrictSettings`→`Settings` rename、`settingsStore.legacy.ts`/`settingsStore.ts` shim削除し全38 importを`SettingsRepository`/`urlWhitelist`等の直接importに置換。`eslint`を`error`昇格。

## なぜなぜ分析

1. なぜindex signatureが残るか → `Settings`がlooseで`StrictSettings`が並存し、移行DoDにrenameが明記されていなかったため
2. なぜrenameされなかったか → Cleansing facadeのbulk `getMany`化が先に必要で、型厳格化はその後にすべきだったため
3. なぜ後にすべきだったか → `settings['typo']`のsilent failはテストで検出されず、緊急性が低く見えたため

→ 解: Slice A完了後に`types.ts:469`を`StrictSettings`に一本化しlegacy shim削除。

## 受け入れ基準 (BDD)

### Scenario 1: typo検出（ハッピーパス）

- **Given** `Settings`が`StrictSettings`に一本化されている
- **When** `settings['typo_key']`を書く
- **Then** `tsc --noEmit`が型エラーで検出する

### Scenario 2: legacy shim削除

- **Given** `settingsStore.legacy.ts`が存在する
- **When** リファクタ後に`grep -rn "from.*settingsStore" src/ --include="*.ts" | grep -v __tests__`を実行する
- **Then** 0件になる

### Scenario 3: 既存テストの維持

- **Given** 既存テストが存在する
- **When** テストを実行する
- **Then** 全テストがPASSする

## DoD

- [ ] `src/utils/storage/types.ts:469`が`StrictSettings`に一本化されている
- [ ] `src/utils/storage/settingsStore.legacy.ts`と`settingsStore.ts`が削除され全38 importが置換されている
- [ ] `eslint.config.js`が`error`昇格している
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS

## 技術メモ

- `settingsStore.legacy.ts` 76行は`SettingsRepository`に吸収済み。`saveSettings`等の呼び出し元38件を`SettingsRepository`経由または`urlWhitelist`等の直接importに置換。
- `eslint.config.js:40-92`の`no-restricted-imports`を`error`にし`patterns: **/settingsStore*`を追加。
