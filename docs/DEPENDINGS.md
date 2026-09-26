# 依存ライブラリ管理状況（DEPENDINGS）

依存パッケージの棚卸し、ライセンスポリシーとの照合結果、アップデート確認の仕組みと最終確認日、現在の運用方針をまとめた文書。

- 最終確認日: 2026-09-26（v6.9.26 時点の実測値を含む）
- 対象: `package.json` の `dependencies` / `devDependencies` / `overrides`、および lockfile 上の推移依存

## 1. 依存の全体像

- ランタイム依存（配布物に同梱）: 2 件のみ。いずれも SQLite WASM 関連
- 開発依存: 28 件。ビルド・テスト・静的解析ツールチェーンで、配布物には含まれない
- lockfile 上のパッケージ総数: 847（うち `node_modules` に実インストールされてライセンス走査の対象になるのは 672）
- 動作環境: Node.js >= 24、npm >= 10（`engines` フィールド）

### ランタイム依存

| パッケージ | 要求バージョン | インストール済み | ライセンス | 用途 |
|---|---|---|---|---|
| `@subframe7536/sqlite-wasm` | ~1.3.1 | 1.3.1 | MIT | SQLite 本体。OPFS / IndexedDB VFS + FTS5 全文検索 |
| `wa-sqlite` | ~1.0.0 | 1.0.0 | MIT | 旧データベースの移行読み取り、Firefox 向け `wasm/wa-sqlite-async.wasm` アセット |

### 開発依存の主要グループ

| グループ | パッケージ（インストール済みバージョン） |
|---|---|
| ビルド | `wxt` (0.21.4), `vite` (8.3.1), `esbuild` (0.28.2), `typescript` (6.0.3) |
| テスト | `vitest` (5.0.2), `@playwright/test` (1.63.0), `happy-dom` (20.14.5), `jsdom` (30.0.1), `@stryker-mutator/core` / `vitest-runner` (10.0.0), `better-sqlite3` (13.0.3) |
| 静的解析・文書 | `eslint` (10.11.0), `@typescript-eslint/eslint-plugin` / `parser` (8.70.1), `knip` (6.38.0), `typedoc` (0.28.20) |
| コンプライアンス | `license-checker` (25.0.1), `@cyclonedx/cyclonedx-npm` (6.0.1) |

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

### 照合結果（2026-09-26 実測）

- `npm run check-licenses` → 672 パッケージ、違反 0 件で PASS（2026-09-26 の依存更新後に再実行）
- ランタイム依存 2 件はともに MIT であり、配布物への同梱にライセンス上の問題はない
- `wa-sqlite` は上流の `package.json` に `license` フィールドが存在しない。同梱の `LICENSE` ファイルが MIT 文面であることを人間が検証済みであり、SBOM 生成時に `scripts/generate-sbom.mjs` の補正テーブル（`LICENSE_CORRECTIONS`、人間検証済みパッケージのみ登録を許可）で MIT を表明している

## 3. アップデート確認の仕組みと最終確認日

| 確認経路 | 内容 | 実行タイミング | 最終確認日 |
|---|---|---|---|
| `npm run release:check:deps` | `npm audit`（critical / high で失敗、devDependencies 込み）+ `npm outdated` による重大パッケージのメジャードリフト警告（warn のみ）+ ライセンス検査 + 実インストールと lockfile の一致検査 | リリース時（`release:check`） | 2026-09-26（6.9.26、全項目 PASS） |
| CI（`.github/workflows/ci.yml`） | `npm audit --audit-level=high --omit=dev`、`npm run check-licenses`、SBOM 生成とアーティファクト保存 | `package.json` / `package-lock.json` 等の変更を含む PR・push | 常時 |
| `.github/workflows/security-audit.yml` | フル `npm audit`（devDependencies 含む、high 以上で失敗） | 毎週月曜 03:00 UTC + 手動起動 | 定期 |

### 直近の `npm outdated` 実測と反映（2026-09-26）

- 更新を検出: 12 件。うち 9 件は同日中に反映済み（`@types/node`, `@typescript-eslint/*`, `@vitest/coverage-v8`, `eslint`, `happy-dom`, `knip`, `vite`, `vitest`）
- `vitest` と `@vitest/coverage-v8` は互いに厳密な peer pin（`vitest@5.0.2` ↔ `@vitest/coverage-v8@5.0.2`）を持つため、必ず同時に更新する
- 意図的に未反映の残り 3 件と理由

| パッケージ | 現在 → 最新 | 未反映の理由 |
|---|---|---|
| `typescript` | 6.0.3 → 7.0.2 | メジャー更新。test プロジェクトの型チェックに大規模な修正が必要（移行判断待ち） |
| `jsdom` | 30.0.1 → 30.1.1 | 同梱 `@asamuzakjp/dom-selector` が導入したセレクタ長上限 2048 文字に、クレンジングルールの長いセレクタが抵触し 86 テストが失敗する。セレクタ短縮のコード変更が前提 |
| `@types/chrome` | 0.2.9 → 0.3.0 | メジャー更新。影響調査が未実施 |

- 脆弱性: critical / high 0 件。moderate 2 件（開発ツールチェーンの推移依存 `qs`。ランタイム監査 `--omit=dev` の対象外）

### 既知の限界

- release gate の outdated チェックは current と wanted（要求範囲内の最新）を比較するため、`typescript` 7 のような範囲外メジャーは警告対象にならない。範囲外メジャーの把握は `npm outdated` の手動確認に依存する
- メジャードリフト警告の監視対象（`CRITICAL_PACKAGES`）: `wxt`, `@subframe7536/sqlite-wasm`, `vitest`, `@playwright/test`, `typescript`, `vite`, `eslint`, `wa-sqlite`

### 依存の実質的な更新

- ランタイム依存は 2026-06-09（`wa-sqlite`）、2026-06-17（`@subframe7536/sqlite-wasm`）に導入後、バージョン範囲の変更はなし
- 開発依存の構成変更は 2026-07-24（未使用依存と Svelte ツールチェーンの削除）以降なし
- 2026-09-26: 範囲内の minor / patch 更新 9 件を lockfile に反映（vitest ペアは要求範囲を ^5.0.2 に更新）。反映後、`npm run validate` と `npm run release:check:deps` が PASS
- 実効バージョンは lockfile で固定し、`npm ci` で再現する。lockfile と実インストールの不一致は release gate が失敗させる

## 4. 現在の扱い

- ランタイム依存は配布物に同梱される。Firefox ビルドでは `wasm/wa-sqlite-async.wasm` を同一オリジンからロードする
- `THIRD_PARTY_NOTICES.md`: `npm run generate-notices` で手動生成する。CI での自動検証は生成結果が macOS / Linux で差異を出すため 2026-07-19 に削除済み。最終生成は 2026-07-24（622 パッケージ分）で、現在の 672 パッケージに対して古い
- `sbom.json`: CycloneDX 形式。`.gitignore` 対象でコミットしない。CI が生成し、90 日間アーティファクトとして保管する
- 更新運用: lockfile を事実源とし、バージョン範囲内の更新は lockfile の更新で取り込む。脆弱性は CI（ランタイム）+ 週次監査（フル）+ リリースゲート（フル）の 3 層で検出する

## 5. 判定と注意点

- 判定: ライセンスポリシー上の問題なし。全 672 パッケージが許容ライセンスに適合し、脆弱性 critical / high は 0 件
- `THIRD_PARTY_NOTICES.md` が 622 パッケージ時点で停止しており現状と乖離している。`npm run generate-notices` の再実行を推奨
- 未反映の更新は 3 件。`jsdom` 30.1.1 はセレクタ長上限のコード修正が前提、`typescript` 7 と `@types/chrome` 0.3 は計画的な移行判断が必要
