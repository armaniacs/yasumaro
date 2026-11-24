# PBI: 正式版(GA)のリリース準備(採番・文書・掲載文)

## ユーザーストーリー
Yasumaro を使い始める・使い続ける利用者として、正式版の版番号、サポート対象の版、README とストア掲載文の説明が、実際に動く拡張機能と一致していてほしい、なぜなら古い記述や開発中の機能が正式機能として書かれていると、データの扱いや競合時の挙動を誤解したまま記録を任せてしまうから。

## 優先度
- 順位: 03/12
- RICE: 10.0(Reach 10 × Impact 2 × Confidence 1.0 / Effort 2)
  - Reach 10: 正式版の全利用者が版番号・README・掲載文を目にする
  - Impact 2: 正式版としての説明の正確さが決まる
  - Confidence 1.0: 対象ファイルと同期の仕組みはコードで確定している
  - Effort 2: 文書の更新と採番(同期はスクリプト化済み)
- 根拠と依存: RICE は最高点だが、README の機能一覧と掲載文が 01(開発中 4 機能の判定、[2026-11-24-02](2026-11-24-02-feat-ga-dev-feature-graduation.md))の裁定に依存するため 3 位。採番とリリースの実行は 07(監査 run-3、[2026-11-24-07](2026-11-24-07-release-ga-security-audit-run3.md))と 08(実機スモーク、[2026-11-24-08](2026-11-24-08-release-ga-smoke-test.md))の完了後にのみ行う

## ビジネス価値
- 正式版の版番号が、すべての版管理ファイルとストア提出物で一致する
- サポート対象の版が SECURITY.md で明示され、脆弱性報告の受付範囲が分かる
- README・掲載文が現在の実装(If-Match による競合検出、開発中機能の扱い)と一致する
- 測定方法: `node scripts/check-version-consistency.js` と `npm run release:check:fast` が緑で、README・SECURITY.md・CHANGELOG・掲載文の各受け入れ基準が満たされていること

## BDD受け入れシナリオ

```gherkin
Scenario: 正式版の版番号がすべての版管理ファイルで一致する
  Given 07(監査)と 08(実機スモーク)が完了している
  When  package.json の version を正式版の版番号にし、node scripts/sync-version.mjs を実行する
  Then  package.json、package-lock.json、docs/version.json、cli/Cargo.toml の版が一致する
  And   node scripts/check-version-consistency.js が成功する
  And   ビルド後の dist/chromium-mv3/manifest.json の version も同じになる

Scenario: 前提が終わっていない段階では採番しない
  Given 07 または 08 が完了していない
  When  リリース準備の作業を進める
  Then  文書の更新(README・SECURITY.md の下書き・CHANGELOG の下書き・掲載文)だけを行う
  And   package.json の version とタグは変更しない

Scenario: README の競合説明が実装と一致する
  Given Obsidian 保存は強い ETag があれば If-Match 付きで PUT し、412 なら 1 回だけ再書き込みする
  When  利用者が README の「Obsidianへの追加の仕組み」を読む
  Then  条件付き書き込み、412 時の 1 回の再書き込み、ETag が無い場合に残る競合リスクが説明されている
  And   「競合により更新内容が失われるリスクがわずかにある」とだけ書いた古い注意は残っていない

Scenario: 開発中のまま残る機能は、正式機能として掲載されない
  Given 01 の裁定で「開発中のまま」となった機能がある
  When  ストア掲載文と README の機能一覧を更新する
  Then  その機能は正式機能の一覧に載らないか、日英の両方で「開発中」と明記される
```

## 受け入れ基準
- [ ] 採番: 正式版の版番号(案: 7.0.0。最終決定は owner)を、07 と 08 の完了後にのみ設定する
- [ ] 版の同期: `package.json`、`package-lock.json`(2 箇所)、`docs/version.json`、`cli/Cargo.toml` が同じ版。`wxt.config.ts` は `pkg.version` を読むため編集不要
- [ ] `docs/RELEASE_POLICY.md` に v7 系のバージョニング方針がある(v6 系の「偶数マイナーは bug fix のみ」を 7.0 にどう当てはめるかを owner が決める)
- [ ] `SECURITY.md` の Supported Versions 表が正式版の系列(例: 7.x)を Supported にし、6.x の扱い(サポート終了日または期間)を明記している
- [ ] README 日本語「Obsidianへの追加の仕組み」が If-Match / 412 の実装を反映している(handoff 記載: 対応済み)。英語側に対応する節を設けるかを決め、設ける場合は日英で内容を揃える
- [ ] README の機能一覧(日本語「### 特徴」、英語「### Features」)が 01 の裁定と一致し、日英で「開発中」表記が揃っている
- [ ] `CHANGELOG.md` に正式版のエントリ(`## [7.0.0] - YYYY-MM-DD` の形式)があり、`[Unreleased]` の内容が取り込まれている。冒頭の案内は `docs/RELEASE_POLICY.md` に従う
- [ ] ストア掲載文: `CHROMEWEBSTORE.md` の Target version と機能一覧・説明文が正式版に合っている。Edge / AMO の掲載文の管理場所を確認し、同じ内容を反映する
- [ ] `AGENTS.md` の Release 節にある「`manifest.json` の version bump」の記述が、実際の版管理(`package.json` を SSOT、`scripts/sync-version.mjs` で同期)と一致している

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない。`testDir/e2e/popup-version-display.spec.ts`(popup の版表示)が正式版の版番号で緑になることを、採番後に確認する

### 統合テスト
- `npm run release:check:fast`(`scripts/release-checks/index.mjs --skip-e2e`)で、版の一致・タグ・CHANGELOG のエントリを確認する
- `scripts/__tests__/publish-stores.test.ts` の Cargo 版ずれ検査が緑であること

### 単体テスト
- `src/utils/__tests__/versionConsistency.test.ts` が新しい版で緑であること
- `npm run check:docs-chars` と `npm run check-i18n` が緑であること(文書の文字種、i18n キーの一致)

## 実装アプローチ
- **Outside-In**: 利用者が最初に読む面(ストア掲載文、README)から直し、内側(版管理ファイル)は最後に採番する
- **Red-Green-Refactor**: 採番は `package.json` の version を先に変えて `check-version-consistency.js` の赤を確認し、`sync-version.mjs` と `cli/Cargo.toml` の更新で緑にする

## 見積もり
2 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: 01(機能一覧・掲載文)。07・08(採番とリリース実行のみ)
- テスタビリティ: 版の一致は既存のスクリプトとテストで機械的に検査できる。文書の正しさはレビューで確認する
- 非機能要件: 文書は Shift-JIS 範囲の文字のみ(EM DASH 禁止)。`public/PRIVACY.md` と `docs/PRIVACY.md` を触る場合は同一内容に保つ
- リスク: 7.0.0 はメジャー更新。ストアの審査で権限の変更がない場合は通常の更新として扱われるが、09(host_permissions の最小化)を同時に入れると既存利用者に再許可を求める場合がある。09 を同梱するかは 01 の ADR の裁定に従う

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。

```bash
rtk grep -n "\"version\"" /Users/yaar/Playground/yasumaro/package.json /Users/yaar/Playground/yasumaro/docs/version.json
rtk grep -n "^version" /Users/yaar/Playground/yasumaro/cli/Cargo.toml
rtk grep -n "pkg.version\|normalizeManifestVersion" /Users/yaar/Playground/yasumaro/wxt.config.ts
rtk grep -n "VERSION_FILES" -A 4 /Users/yaar/Playground/yasumaro/scripts/check-version-consistency.js
rtk grep -n "Supported Versions" -A 6 /Users/yaar/Playground/yasumaro/SECURITY.md
rtk grep -n "Obsidianへの追加の仕組み" -A 22 /Users/yaar/Playground/yasumaro/README.md
rtk grep -n "Target version" /Users/yaar/Playground/yasumaro/CHROMEWEBSTORE.md
rtk grep -n "manifest.json" /Users/yaar/Playground/yasumaro/AGENTS.md
```

- 現在の版: 6.9.76(`package.json`、`docs/version.json`、`cli/Cargo.toml` で一致)
- 版の SSOT: `package.json`。`wxt.config.ts` は `pkg.version` を読み、`normalizeManifestVersion()` で prerelease を落として manifest に入れる。リポジトリ直下に `manifest.json` は無い(ビルド後の `dist/chromium-mv3/manifest.json` のみ)
- 同期: `scripts/sync-version.mjs` が `docs/version.json` と `package-lock.json` を `package.json` に合わせる(`npm run build` 系で自動実行)。`cli/Cargo.toml` は手動で合わせる(`scripts/publish/cargo.mjs` が公開前に版ずれを検出して失敗する)
- 検査: `scripts/check-version-consistency.js`(package.json / wxt.config.ts / docs/version.json)、`scripts/release-checks/check-release-metadata.mjs`(加えて dist の manifest、タグ、CHANGELOG のエントリ)
- CONTRIBUTING.md の「### リリースフロー」(日本語)と「### Release Process」(英語)は、CHANGELOG をリリースノートに使うこと、`docs/RELEASE_POLICY.md` のブランド案内、Cargo の同期を定めている
- SECURITY.md の Supported Versions: 6.x が Supported、< 6.0 が非対象
- README: 日本語「Obsidianへの追加の仕組み」はコミット 6d39eb66e で If-Match / 412 を反映済み。英語側に対応する節は無い。日本語の機能一覧では 3 機能に「(開発中の機能)」が付くが、英語の Features には付かない
- 掲載文: `CHROMEWEBSTORE.md` は Target version 6.9.75 のまま。Edge / AMO の掲載文を管理するファイルはリポジトリ内で見つからなかった(要確認。`dev-docs/edge-partner-center-issue.local.md` はローカル専用ファイル)
- `docs/RELEASE_POLICY.md` は v6 系の方針のみで、v7 系の記述が無い

### 範囲
- 含める: 採番(前提完了後)、版の同期、RELEASE_POLICY の v7 方針、SECURITY.md、README(日英)、CHANGELOG、ストア掲載文、AGENTS.md の Release 節の記述修正
- 含めない: タグ push とストア提出の実行(owner が行う)、機能の変更、09 の権限変更

### 実装手順
1. handoff ファイルを読み、済んだ項目(README 日本語の競合説明)を確認する
2. 01 の ADR を読み、昇格した機能と開発中のまま残る機能を確認する
3. README の機能一覧(日英)と `CHROMEWEBSTORE.md` の Full description / Features を ADR に合わせる。英語側の Obsidian 追加の仕組みの節を設けるか決める
4. Edge / AMO の掲載文の管理場所を owner に確認し、同じ内容を反映する
5. `docs/RELEASE_POLICY.md` に v7 系の方針の節を追加する(内容は owner が決める)
6. `SECURITY.md` の Supported Versions 表を更新する
7. `CHANGELOG.md` の `[Unreleased]` を正式版エントリの下書きにまとめる(見出しの版と日付は採番時に確定)
8. `AGENTS.md` の Release 節の `manifest.json` の記述を、実際の版管理に合わせて直す
9. 07 と 08 の完了を台帳と handoff で確認してから、`package.json` の version を変更し、`node scripts/sync-version.mjs` を実行し、`cli/Cargo.toml` を手動で合わせる
10. `node scripts/check-version-consistency.js`、`npm run validate`、`npm run release:check:fast` を順に実行する

### 落とし穴
- 07・08 より前に採番しない。採番後に監査やスモークで修正が入ると、同じ版番号で中身の違うビルドが生まれる
- `package.json` だけを変えると `package-lock.json` が古いまま残り、`versionConsistency.test.ts` が赤になる。必ず `sync-version.mjs` を通す
- `cli/Cargo.toml` は `sync-version.mjs` の対象外。合わせ忘れるとタグ push 後の crates.io 公開ステップで失敗する
- CHROMEWEBSTORE.md の変更履歴の行(`- 6.9.75 (...)`)は既存の書式に合わせる
- CHANGELOG にはローカル専用ファイル(`.gitignore` 対象。`CLAUDE.local.md` など)の変更を記録しない
- 文書に EM DASH(U+2014)を入れない。コードからの引用でも `―`(U+2015)に置き換える

## Definition of Done
- [ ] 全 BDD シナリオが、スクリプトの実行結果または文書レビューで検証されている
- [ ] `npm run validate` と `npm run release:check:fast` が緑
- [ ] コードレビュー(文書レビュー)完了
- [ ] ドキュメント更新済み(README 日英、SECURITY.md、CHANGELOG、RELEASE_POLICY、CHROMEWEBSTORE.md、AGENTS.md)
- [ ] 採番は 07・08 の完了後に行われ、その旨が handoff に記録されている

## 引き継ぎ
状態: 一部着手(handoff 記載: README の Obsidian 競合記述のみ完了)。進捗と引き継ぎ情報は [handoff/2026-11-24-04-release-ga-preparation.md](handoff/2026-11-24-04-release-ga-preparation.md) に記録する(ファイルが無ければ未着手)。
