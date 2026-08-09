# PBI-24: src/utils/ サブディレクトリ分割 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-26-24-refactor-utils-subdirectory-split.md`（フェーズ0再調査済み・2026-07-27）

**Goal:** `src/utils/`直下62ファイル（`__tests__`除く）を機能別サブディレクトリに段階的に分割し、ダンピンググラウンド化を解消する。1グループずつ独立したコミットで進め、各グループ完了時点でビルド・型チェック・全テストが成功する状態を維持する。

**Architecture:** 既存の`src/utils/logger/`（バレル方式: `logger.ts`がre-exportのみを行うバレルとして残り、実体は`logger/{types,core,api}.ts`）と同じパターンを踏襲する。呼び出し元が多いファイルはバレル維持、呼び出し元が少ないファイルは呼び出し元のimportパスを直接サブディレクトリに向けて更新しバレルを作らない（PBI-22で確立した方針）。

**Tech Stack:** TypeScript, Vitest, ESM（`.js`拡張子importが必須）

---

## グルーピング全体設計

62ファイルを以下のグループに分類する（詳細は各Taskで）。既存サブディレクトリ（`storage/`, `trustDb/`, `logger/`, `aiSummaryCleaner/`, `contentExtractor/`, `ublockParser/`）はそのまま。

| グループ | 対象ファイル | 優先度 | 呼び出し元規模 |
|---|---|---|---|
| **crypto/**（Task 1） | `crypto.ts`, `typesCrypto.ts` | 最優先（最小・最安全） | プロダクション5, テスト6 |
| **privacy/**（Task 2） | `piiSanitizer.ts`, `piiStripper.ts`, `privacyChecker.ts`, `privacyStatusCodes.ts` | 高 | 要調査（Task内で実施） |
| **i18n/**（Task 3） | `i18n.ts`, `i18n-dom.ts`, `i18nPlural.ts`, `localeUtils.ts` | 高 | 要調査（Task内で実施） |
| **csp/**（Task 4） | `cspDomains.ts`, `cspValidator.ts` | 中 | 要調査（Task内で実施） |
| その他（`domainUtils.ts`, `url*.ts`等） | 残り約48ファイル | 低（本計画のスコープ外、後続PBIへ） | - |

**重要な方針判断**: 本PBIの受け入れ基準は「少なくとも1グループの移行が完了していること」であり、全62ファイルの完全分割ではない。本計画はTask 1（crypto/）を確実に完了させ、Task 2〜4は「時間があれば追加で進める」という位置づけとする。Task 1のみでもPBIのDefinition of Doneを満たす。

---

## Task 1: crypto/ サブディレクトリへの移行（必須・最優先）

**Files:**
- Move: `src/utils/crypto.ts` → `src/utils/crypto/index.ts`
- Move: `src/utils/typesCrypto.ts` → `src/utils/crypto/types.ts`
- Move: `src/utils/__tests__/crypto.test.ts` → `src/utils/crypto/__tests__/crypto.test.ts`
- Modify（importパス更新、フルパス）:
  - `src/background/handlers/urlNotificationHandlers.ts`
  - `src/background/headerDetector.ts`
  - `src/dashboard/encryptedBackupService.ts`
  - `src/popup/privacyConsent.ts`
  - `src/popup/statusChecker.ts`
  - `src/background/__tests__/headerDetector.test.ts`
  - `src/background/__tests__/service-worker.test.ts`
  - `src/utils/__tests__/settingsExportImport-signature.test.ts`
  - `src/utils/__tests__/settingsExportImport.test.ts`
  - `src/utils/__tests__/storage-security.test.ts`

**事前確認コマンド（着手時に必ず再実行し、上記リストが最新か確認すること）:**
```bash
grep -rln "utils/crypto\.js\|utils/typesCrypto\.js" src/ entrypoints/
```

- [ ] **Step 1: 移行前に現状のテストが全てパスすることを確認する**

```bash
npm run type-check && npm test
```

Expected: 全テストパス（ベースライン確認）

- [ ] **Step 2: `crypto.ts`の内容を確認し、`typesCrypto.ts`との依存関係を把握する**

```bash
head -20 src/utils/crypto.ts
cat src/utils/typesCrypto.ts
grep -n "from.*typesCrypto" src/utils/crypto.ts
```

`crypto.ts`が`typesCrypto.ts`の型定義（`SubtleCrypto`拡張の`timingSafeEqual`宣言）に依存しているか確認する。循環参照がないことを確認してから移行する。

- [ ] **Step 3: `src/utils/crypto/`ディレクトリを作成し、ファイルを移動する**

```bash
mkdir -p src/utils/crypto/__tests__
git mv src/utils/crypto.ts src/utils/crypto/index.ts
git mv src/utils/typesCrypto.ts src/utils/crypto/types.ts
git mv src/utils/__tests__/crypto.test.ts src/utils/crypto/__tests__/crypto.test.ts
```

- [ ] **Step 4: 移動したファイル内の相対import文を修正する**

`src/utils/crypto/index.ts`内で`typesCrypto.ts`を参照している箇所（あれば）を`./types.js`に変更。
`src/utils/crypto/index.ts`内で他の`../`相対パス（例: `./errorUtils.js`等）があれば、ディレクトリが1段深くなった分`../errorUtils.js`に修正する。

```bash
grep -n "^import" src/utils/crypto/index.ts
```

出力された全import文を確認し、`./`で始まるものは全て`../`に、既存の`../`で始まるものは`../../`に修正する（1段深くなったため）。

- [ ] **Step 5: 移動したテストファイル内のimportパスを修正する**

```bash
grep -n "^import" src/utils/crypto/__tests__/crypto.test.ts
```

`from '../crypto.js'`のようなパスを`from '../index.js'`に、他の`../../`参照は`../../../`に修正する（テストファイルも1段深くなったため）。

- [ ] **Step 6: プロダクションコード5ファイルのimportパスを更新する**

以下の置換を各ファイルに適用する（`from '.../utils/crypto.js'` → `from '.../utils/crypto/index.js'`、`from '.../utils/typesCrypto.js'` → `from '.../utils/crypto/types.js'`）:

- `src/background/handlers/urlNotificationHandlers.ts`
- `src/background/headerDetector.ts`
- `src/dashboard/encryptedBackupService.ts`
- `src/popup/privacyConsent.ts`
- `src/popup/statusChecker.ts`

各ファイルで実際のimport文を`grep -n "utils/crypto"`で確認してから、Editツールで正確な相対パスに置換すること（ファイルごとに`../`の深さが異なるため機械的なsedは使わない）。

- [ ] **Step 7: テストファイル5件のimportパスを更新する**

- `src/background/__tests__/headerDetector.test.ts`
- `src/background/__tests__/service-worker.test.ts`
- `src/utils/__tests__/settingsExportImport-signature.test.ts`
- `src/utils/__tests__/settingsExportImport.test.ts`
- `src/utils/__tests__/storage-security.test.ts`

Step 6と同様、各ファイルの実際のimport文を確認してから修正する。`vi.mock('../crypto.js', ...)`のようなモック宣言のパスも見落とさないこと。

- [ ] **Step 8: 型チェック・テスト・ビルドで検証する**

```bash
npm run type-check
```

Expected: エラーなし（importパス漏れがあればここで検出される）

```bash
npm test
```

Expected: 全テストパス（新しいテストパス`src/utils/crypto/__tests__/crypto.test.ts`が認識され実行されること）

```bash
npm run build
```

Expected: ビルド成功。`dist/chromium-mv3/chunks/`にcrypto関連チャンクが生成されることを確認。

- [ ] **Step 9: `manifest.json`（`wxt.config.ts`）への影響を確認する**

`crypto.ts`がContent Scriptから参照されていないか確認する（`web_accessible_resources`への影響有無）:

```bash
grep -rn "utils/crypto" entrypoints/content*.ts src/content/*.ts 2>/dev/null
```

参照がなければ対応不要（PBI-28で`web_accessible_resources`は`content-extractor.js`と`icons/icon48.png`のみに絞り込み済みのため、そもそも影響しない可能性が高い）。

---

## Task 2: privacy/ サブディレクトリへの移行（任意・時間があれば）

**Files:**
- Move: `src/utils/piiSanitizer.ts` → `src/utils/privacy/piiSanitizer.ts`
- Move: `src/utils/piiStripper.ts` → `src/utils/privacy/piiStripper.ts`
- Move: `src/utils/privacyChecker.ts` → `src/utils/privacy/privacyChecker.ts`
- Move: `src/utils/privacyStatusCodes.ts` → `src/utils/privacy/privacyStatusCodes.ts`
- Move: 対応する`src/utils/__tests__/piiSanitizer*.test.ts`等 → `src/utils/privacy/__tests__/`

- [ ] **Step 1: 移行対象4ファイルの全呼び出し元を洗い出す**

```bash
grep -rln "utils/piiSanitizer\.js\|utils/piiStripper\.js\|utils/privacyChecker\.js\|utils/privacyStatusCodes\.js" src/ entrypoints/
```

**注意**: `piiSanitizer.ts`はPBI-14（addLogメッセージサニタイズ、アーカイブ済み）や多数のcontent/background処理から広く参照されている可能性が高い。Task 1（crypto、5+6ファイル）より呼び出し元が多い可能性があるため、着手前に必ず件数を確認し、10ファイルを超えるようであれば別コミットとして切り出すか、本Taskをスキップして次のPBIに進む判断をすること。

- [ ] **Step 2: `src/utils/privacy/`ディレクトリを作成しファイル移動**

```bash
mkdir -p src/utils/privacy/__tests__
git mv src/utils/piiSanitizer.ts src/utils/privacy/piiSanitizer.ts
git mv src/utils/piiStripper.ts src/utils/privacy/piiStripper.ts
git mv src/utils/privacyChecker.ts src/utils/privacy/privacyChecker.ts
git mv src/utils/privacyStatusCodes.ts src/utils/privacy/privacyStatusCodes.ts
```

（対応するテストファイルも同様に`git mv`する。Step 1の結果に応じてテストファイル名を特定すること）

- [ ] **Step 3: 移動したファイル間の相互import・全呼び出し元のimportパスを更新する**

Task 1のStep 4〜7と同じ要領で、移動先ファイル同士の相対参照（同じ`privacy/`内なら`./`のまま、外部参照は`../`を1つ追加）と、外部呼び出し元のパスを個別に確認・修正する。

- [ ] **Step 4: 型チェック・テスト・ビルドで検証する**

```bash
npm run type-check && npm test && npm run build
```

Expected: 全て成功

---

## Task 3: i18n/ サブディレクトリへの移行（任意・時間があれば）

**Files:**
- Move: `src/utils/i18n.ts` → `src/utils/i18n/index.ts`
- Move: `src/utils/i18n-dom.ts` → `src/utils/i18n/dom.ts`
- Move: `src/utils/i18nPlural.ts` → `src/utils/i18n/plural.ts`
- Move: `src/utils/localeUtils.ts` → `src/utils/i18n/localeUtils.ts`

**注意**: `i18n.ts`はコメントで明示的に「Service Worker / Offscreen Documentから安全にimportできる、documentに依存しないモジュール」と宣言されており、`i18n-dom.ts`はDOM依存のUI専用ヘルパーとして意図的に分離されている。この設計意図（バンドル境界）を壊さないよう、ファイルは移動してもモジュール間の责務分離（DOM依存 vs 非依存）は変更しないこと。

- [ ] **Step 1: 4ファイルの全呼び出し元を洗い出す**

```bash
grep -rln "utils/i18n\.js\|utils/i18n-dom\.js\|utils/i18nPlural\.js\|utils/localeUtils\.js" src/ entrypoints/
```

`i18n.ts`はpopup/dashboard/background/content全域から広く参照されている可能性が高い（i18n機能はほぼ全画面で使われるため）。件数が多い場合、バレル方式（`src/utils/i18n.ts`をバレルとして残す）を検討すること。

- [ ] **Step 2: 呼び出し元件数に応じて移行方式を決定する**

10ファイル以下: 直接importパスを全箇所修正（Task 1と同様の方式）
10ファイル超: `src/utils/i18n.ts`をバレルとして残し、実体を`src/utils/i18n/`配下に移動する方式（`logger.ts`と同じパターン）

- [ ] **Step 3: 選択した方式でファイル移動・import更新を実施する**

- [ ] **Step 4: 型チェック・テスト・ビルドで検証する**

```bash
npm run type-check && npm test && npm run build
```

---

## Task 4: csp/ サブディレクトリへの移行（任意・時間があれば）

**Files:**
- Move: `src/utils/cspDomains.ts` → `src/utils/csp/domains.ts`
- Move: `src/utils/cspValidator.ts` → `src/utils/csp/validator.ts`

**注意**: `cspDomains.ts`は`wxt.config.ts`から直接importされている（`AI_PROVIDER_HOST_PERMISSIONS`, `buildConnectSrcDomains`）。`wxt.config.ts`はプロジェクトルート直下にあるため、移動後は相対パスが`./src/utils/csp/domains.js`のように変わる点に注意する。

- [ ] **Step 1: 2ファイルの全呼び出し元を洗い出す（wxt.config.tsを含む）**

```bash
grep -rln "utils/cspDomains\.js\|utils/cspValidator\.js" src/ entrypoints/ wxt.config.ts
```

- [ ] **Step 2: `src/utils/csp/`ディレクトリを作成しファイル移動**

```bash
mkdir -p src/utils/csp/__tests__
git mv src/utils/cspDomains.ts src/utils/csp/domains.ts
git mv src/utils/cspValidator.ts src/utils/csp/validator.ts
```

- [ ] **Step 3: `wxt.config.ts`を含む全呼び出し元のimportパスを更新する**

`wxt.config.ts`冒頭の`import { AI_PROVIDER_HOST_PERMISSIONS, ... } from './src/utils/cspDomains.js';`を`./src/utils/csp/domains.js`に修正する。

- [ ] **Step 4: 型チェック・テスト・ビルドで検証する**

```bash
npm run type-check && npm test && npm run build
```

**追加確認**: `wxt.config.ts`の変更はビルド設定そのものに影響するため、`npm run build`が成功するだけでなく、生成された`manifest.json`の`host_permissions`・CSPが変更前と同一であることを`git diff dist/`相当の比較で確認すること（ビルド前後でdist/を一時退避して比較する等）。

---

## 全体検証（Task 1完了時点で必須）

- [ ] `npm run type-check` が成功する
- [ ] `npm test` で全テストがパスする（新しいテストパスも認識されること）
- [ ] `npm run build` が成功する
- [ ] `git status` で意図しないファイルが変更されていないことを確認する
- [ ] `pbi/00-INDEX.md` の該当行を更新し、Task 1（crypto/）完了を反映する（Task 2〜4が未完了の場合は「部分実装」として記録する）

## コミット方針

Task単位で個別コミットする（`git add`は個別ファイル指定、`-A`/`.`禁止）。Conventional Commits形式:

```
refactor(utils): crypto関連ファイルをsrc/utils/crypto/へ移動

PBI-24のフェーズ1として、最も影響範囲の小さいcrypto.ts/typesCrypto.tsを
サブディレクトリに移行。呼び出し元11ファイル（プロダクション5+テスト6）の
importパスを更新。
```

Task 2, 3, 4も同様にそれぞれ個別コミットとする。
