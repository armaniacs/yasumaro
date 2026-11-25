# 依存ライブラリ管理状況（DEPENDINGS）

依存パッケージの棚卸し、ライセンスポリシーとの照合結果、アップデート確認の仕組みと最終確認日、現在の運用方針をまとめた文書。

- 最終確認日: 2026-11-26（依存更新ラウンドで minor/patch を反映。監査スコープは §3 の二層化定義に従う）
- 対象: `package.json` の `dependencies` / `devDependencies` / `overrides`、および lockfile 上の推移依存

## 1. 依存の全体像

- ランタイム依存（配布物に同梱）: 2 件のみ。いずれも SQLite WASM 関連
- 開発依存: 29 件。ビルド・テスト・静的解析ツールチェーンで、配布物には含まれない
- lockfile 上のパッケージ総数: 938（うち `node_modules` に実インストールされてライセンス走査の対象になるのは 744）
- 動作環境: Node.js >= 24、npm >= 10（`engines` フィールド）

### ランタイム依存

| パッケージ | 要求バージョン | インストール済み | ライセンス | 用途 |
|---|---|---|---|---|
| `@subframe7536/sqlite-wasm` | ~1.4.1 | 1.4.1 | MIT | SQLite 本体。OPFS / IndexedDB VFS + FTS5 全文検索 |
| `wa-sqlite` | ~1.0.0 | 1.0.0 | MIT | 旧データベースの移行読み取り、Firefox 向け `wasm/wa-sqlite-async.wasm` アセット |

### 開発依存の主要グループ

| グループ | パッケージ（インストール済みバージョン） |
|---|---|
| ビルド | `wxt` (0.21.5), `vite` (8.3.8), `esbuild` (0.28.2), `typescript` (7.0.2) |
| テスト | `vitest` (5.1.1), `@playwright/test` (1.65.1), `happy-dom` (21.0.4), `jsdom` (31.0.1), `@stryker-mutator/core` / `vitest-runner` (10.1.1), `better-sqlite3` (13.2.0) |
| 静的解析 | `oxlint` (1.94.0), `eslint` (10.15.0), `knip` (6.47.0) |
| コンプライアンス | `license-checker` (25.0.1), `@cyclonedx/cyclonedx-npm` (7.0.1) |

### overrides（ピン留め）

互換性・セキュリティ上の理由で 5 件を `overrides` に固定している。

- `adm-zip`: ^0.6.1
- `htmlparser2`: ~12.0.0
- `shell-quote`: >=1.10.0
- `tmp`: >=0.2.6
- `uuid`: ^11.1.1

`htmlparser2` には override が不要になったかを検証する `npm run check-htmlparser2` が用意されている。

### 自前 Rust / WASM

`public/wasm/` の `pii_sanitizer` / `tag_cooccur` / `textrank` は npm 依存ではなく、`wasm/` 配下の自前クレートを `npm run build:wasm`（wasm-pack）でビルドした成果物。ライセンスは本プロジェクトの MIT に従う。

## 2. ライセンスポリシーとの照合

- 本プロジェクトのライセンス: MIT（`LICENSE.md`）
- ポリシーの実装: `scripts/check-licenses.mjs`（`npm run check-licenses`）
  - 許容ライセンス: MIT, ISC, BSD, Apache-2.0, CC0 / CC-BY, WTFPL, Unlicense, MPL-2.0, BlueOak-1.0.0, 0BSD, Python-2.0, MIT-0 など
  - 禁止ライセンス: GPL, AGPL, LGPL, SSPL, OSL, EUPL, NPL, Commons Clause。ただし `(MIT OR GPL-3.0-or-later)` のように許容側を選択できるデュアルライセンスは例外
  - ライセンス不明（UNKNOWN）は警告のみで失敗にはしない

### 照合結果（2026-11-26 実測）

- `npm run check-licenses` → 756 パッケージ、違反 0 件で PASS（2026-11-26 に再実行）
- ランタイム依存 2 件はともに MIT であり、配布物への同梱にライセンス上の問題はない
- `wa-sqlite` は上流の `package.json` に `license` フィールドが存在しない。同梱の `LICENSE` ファイルが MIT 文面であることを人間が検証済みであり、SBOM 生成時に `scripts/generate-sbom.mjs` の補正テーブル（`LICENSE_CORRECTIONS`、人間検証済みパッケージのみ登録を許可）で MIT を表明している

## 3. アップデート確認の仕組みと最終確認日

| 確認経路 | 内容 | 実行タイミング | 最終確認日 |
|---|---|---|---|
| `npm run release:check:deps` | 二層判定。prod スコープ（`--omit=dev`、配布物に混入しうる範囲）の critical / high は失敗。dev-only（フル監査にのみ現れる）は §6 の到達可能性メモがあれば警告（通過）、なければ失敗 + `npm outdated` による重大パッケージのメジャードリフト警告（warn のみ）+ ライセンス検査 + 実インストールと lockfile の一致検査 | リリース時（`release:check`） | 2026-10-25（6.9.59、dev-only HIGH 4 件を warn として PASS） |
| `npm run check:deps:audit-warn`（`validate` に組込） | 上と同じ二層分類を fail→warn に読み替えて常時 exit 0 で報告。日常ゲートでの早期認知用。ネットワーク到達不能時も警告のみ | `npm run validate` の一部として毎回 | 2026-10-25（導入） |
| `npm run check:dependings`（`release:check --category=dependings` に組込） | 本書 §1 の数値（ランタイム表・主要群表・件数・`THIRD_PARTY_NOTICES.md` 件数・最終確認日）と `package.json` / `package-lock.json` の突合。不一致は FAIL。数値の再生成は `npm run generate:dependings` | リリース時（`release:check`） | 2026-11-26（導入） |
| CI（`.github/workflows/ci.yml`） | `npm audit --audit-level=high --omit=dev`（= prod スコープ。release gate の prod 層と同義）、`npm run check-licenses`、SBOM 生成とアーティファクト保存 | `package.json` / `package-lock.json` 等の変更を含む PR・push | 常時 |
| `.github/workflows/security-audit.yml` | フル `npm audit`（devDependencies 含む、high 以上で失敗） | 毎週月曜 03:00 UTC + 手動起動 | 定期 |

### 直近の依存更新（2026-11-26）

- 反映済み（本書 §1 の数値に反映）: `typescript` ^7.0.2（oxlint 化で `@typescript-eslint/*` 撤去）、`@subframe7536/sqlite-wasm` ~1.4.1、`happy-dom` 21.0.4、`eslint` 10.15.0、`@stryker-mutator/*` 10.1.1、`vite` 8.3.8、`vitest` 5.1.1 / `@vitest/coverage-v8` 5.1.1、`jsdom` 31.0.1、`@playwright/test` 1.65.1
- 意図的に未反映の残り 1 件: `@peculiar/webcrypto` 2.0.0（§5 参照）
- 履歴として残す: 2026-11-08 時点の記録は以下に据え置く

### 直近の依存更新（2026-11-08）

- 反映: `eslint` 10.9→10.14、`@typescript-eslint/*` 8.67→8.72.1、`wxt` 0.21.4→0.21.5、`vite` 8.2→8.3.6、`vitest` 5.0.3→5.1.0（`@vitest/coverage-v8` とlockstepで同時更新）、`@playwright/test` 1.62→1.65、`@types/node` 26.2→26.6、`jsdom` 30.1→31.0（メジャー更新。フルスイート18579件緑・型・lint・ライセンス・ビルド緑で回帰なし）
- 意図的に未反映の残り 1 件と理由（2026-09-26 から変更なし）

- 更新を検出: 12 件。うち 11 件は同日中に反映済み（`@types/chrome`, `@types/node`, `@typescript-eslint/*`, `@vitest/coverage-v8`, `eslint`, `happy-dom`, `jsdom`, `knip`, `vite`, `vitest`）
- `vitest` と `@vitest/coverage-v8` は互いに厳密な peer pin（`vitest@5.0.2` ⇔ `@vitest/coverage-v8@5.0.2`）を持つため、必ず同時に更新する
- 意図的に未反映の残り 1 件と理由

| パッケージ | 現在 → 最新 | 未反映の理由 |
|---|---|---|
| `typescript` | 6.0.3 → 7.0.2 | メジャー更新。test プロジェクトの型チェックに大規模な修正が必要（移行判断待ち） |

- 脆弱性: critical / high 0 件。moderate 2 件（開発ツールチェーンの推移依存 `qs`。ランタイム監査 `--omit=dev` の対象外）

### 既知の限界

- release gate の outdated チェックは current と wanted（要求範囲内の最新）を比較するため、`typescript` 7 のような範囲外メジャーは警告対象にならない。範囲外メジャーの把握は `npm outdated` の手動確認に依存する
- メジャードリフト警告の監視対象（`CRITICAL_PACKAGES`）: `wxt`, `@subframe7536/sqlite-wasm`, `vitest`, `@playwright/test`, `typescript`, `vite`, `eslint`, `wa-sqlite`

### 依存の実質的な更新

- ランタイム依存は 2026-06-09（`wa-sqlite`）、2026-06-17（`@subframe7536/sqlite-wasm`）に導入。2026-11-26 時点の要求範囲は `@subframe7536/sqlite-wasm` ~1.4.1、`wa-sqlite` ~1.0.0
- 開発依存の構成変更は 2026-07-24（未使用依存と Svelte ツールチェーンの削除）以降、oxlint 移行と TypeScript 7 移行（`@typescript-eslint/*` 撤去、`oxc-parser` 追加等）を反映済み
- 2026-09-26: 範囲内の minor / patch 更新 9 件を lockfile に反映（vitest ペアは要求範囲を ^5.0.2 に更新）。反映後、`npm run validate` と `npm run release:check:deps` が PASS
- 実効バージョンは lockfile で固定し、`npm ci` で再現する。lockfile と実インストールの不一致は release gate が失敗させる

## 4. 現在の扱い

- ランタイム依存は配布物に同梱される。Firefox ビルドでは `wasm/wa-sqlite-async.wasm` を同一オリジンからロードする
- `THIRD_PARTY_NOTICES.md`: `npm run generate-notices` で手動生成する。CI での自動検証は生成結果が macOS / Linux で差異を出すため 2026-07-19 に削除済み。最終生成は 2026-11-26（744 パッケージ分）で、現在の 744 パッケージと一致
- `sbom.json`: CycloneDX 形式。`.gitignore` 対象でコミットしない。CI が生成し、90 日間アーティファクトとして保管する
- 更新運用: lockfile を事実源とし、バージョン範囲内の更新は lockfile の更新で取り込む。脆弱性は CI（prod スコープ）+ 日常 gate（`validate` 内 audit warn）+ 週次監査（フル）+ リリースゲート（二層判定）+ 文書鮮度検査（`check:dependings`）の 5 層で検出する。各層のスコープ定義は §3 の表を正とし、CI と release で「監査」の意味がずれないようにする。文書数値の更新は `npm run generate:dependings` で行い、§5 の判定文と §6 の受容記録は手書きのままとする

## 5. 判定と注意点

- 判定: ライセンスポリシー上の問題なし。全 756 パッケージが許容ライセンスに適合（2026-11-26 実測）。prod スコープの脆弱性 critical / high は 0 件。フル監査の dev-only HIGH 4 件（node-forge 系、同一原因の重複検出）は §6.1 の受容記録に基づき warn として出荷を継続する
- `THIRD_PARTY_NOTICES.md` は 2026-11-26 に 744 パッケージ分で再生成済みで、lockfile 由来の件数と一致している
- 未反映の更新は 1 件。`@peculiar/webcrypto` 2.0.0 は webcrypto-core 2 系の parity 未実測のため保留（1.7.2 の JWK `alg` 修正は範囲内 patch として適用済み）。`typescript` 7 は移行完了（`typescript` ^7.0.2、oxlint 化で `@typescript-eslint/*` 撤去）のため本項目から除去した

## 6. リスク受容記録

修正版が存在しない脆弱性は「直す」のではなく「評価して受容する」。以降の受容は 6.2 の様式で記録する。

### 6.1 node-forge RSA 署名検証バイパス（2026-10-25 受容）

- 対象: GHSA-86w9-cpqp-85rv（CVSS 7.5）。node-forge@1.4.0 の RSA PKCS#1 v1.5 検証不備
- 経路: node-forge@1.4.0 ← @devicefarmer/adbkit@3.3.9 ← web-ext@10.8.0 ← wxt@0.21.4（全て devDependencies）
- 到達不能の根拠:
  - 出荷物（dist / ストア zip）に devDependencies は同梱されない。本番依存の監査は 0 件
  - 当拡張は Android で動作しない（wxt.config.ts に明記）。`web-ext run` の Android 経路は未使用
  - node-forge が実行されるのは adbkit の ADB 認証路のみで、通常の build では発火しない
- 受容内容: `release:check:deps` の HIGH 4 件（同一原因の重複検出）を既知・受容として出荷を継続する
- 期限・再評価トリガー: wxt / web-ext の次回更新時、または node-forge に修正版・後継が出た時。月次トリアージで確認する
- 記録日: 2026-10-25

### 6.2 受容書ひな形

ゲートは本文中に GHSA / CVE 識別子（アドバイザリ URL 由来、表記揺れ吸収のため大文字照合）が存在するかでメモ有無を判定する。識別子がない検出はパッケージ名で照合する。ひな形の各項目を埋め、識別子行を必ず残すこと。

- 対象（CVE / GHSA・CVSS）:
- 経路（バージョン付きチェーン・dev / prod の別）:
- 到達不能の根拠（出荷物混入の有無・未使用機能の裏付け・発火条件）:
- 受容内容（何を・どこまで許容するか）:
- 期限・再評価トリガー:
- 記録日:
- 承認（リリース責任者）:
