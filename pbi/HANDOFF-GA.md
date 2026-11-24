# 引き継ぎ: 正式版(GA)リリース準備

このファイルだけ読めば、現状と次の作業が分かるように書いている。
最終更新: 2026-11-24。作成者: 前任モデル(Opus 5.5 / Sonnet 5.5)。

## 1. 何のプロジェクトか

Yasumaro: AI 要約付きの閲覧履歴を Obsidian とローカル SQLite に保存する、Manifest V3 のブラウザ拡張(TypeScript)。
現在 6.9.76。Chrome / Edge / Firefox のストアで公開済み。owner は、正式版(GA)を出そうとしている。

- リポジトリ: `/Users/yaar/Playground/yasumaro`
- 作業ブランチ: `1124a`(`main` が基点。push とマージは未実施)
- 作業は PBI(`pbi/` 配下のファイル)で管理する。台帳は [2026-11-24-00-backlog-ga-release.md](2026-11-24-00-backlog-ga-release.md)(RICE 表、実行順、依存マップ)

## 2. 守るルール(ユーザーの指示。必ず従う)

プロジェクトの `CLAUDE.md` / `CLAUDE.local.md` と、ユーザー共通の `CLAUDE.md` が正。要点だけ書く。

- 応答・説明・コミットメッセージは日本語。コード・識別子・コード内コメントは英語。絵文字は使わない
- コメントは非自明な WHY だけ。変更履歴やタスク ID は書かない。docs にも経緯や issue 参照を書かず、最新仕様だけを書く
- コミットは Conventional Commits(feat / fix / docs / refactor / test / chore / ci)。`git add -A` と `git add .` は使わず、対象ファイルを個別に add する。`push` はユーザーの指示があるまでしない
- ファイル編集は Edit / Write のみ。`sed -i`、`awk` での書き換えは禁止。Edit の前に必ず Read する(フォーマッタ hook が走るので、続けて Edit する前にも再 Read)。同じファイルへの Edit は 1 回にまとめる
- Bash は絶対パスで、単独のコマンドとして実行する。`cd` と `;` `&&` の連結は避ける。git は `git -C <abs>`、npm は `npm --prefix <abs>`。`rm -rf` と `~/Secrets` の参照は deny に当たる
- TypeScript で `any` / `unknown` を使わない(テストは許容)。ESM の import は `.js` 拡張子。`value` のハードコードは避ける
- 実装作業はサブエージェント駆動で行う(`subagent-driven-development` の方針)。独立したタスクは並列にし、統合・検証・レビューは本体セッションが担う
- docs は Shift-JIS で表せる文字だけにする。EM DASH(U+2014)は禁止で、`―`(U+2015)を使う。検査は `node /Users/yaar/Playground/yasumaro/scripts/check-docs-chars.mjs`
- `public/PRIVACY.md` と `docs/PRIVACY.md` は常に同一にする
- 待ち時間の polling は 10 秒以下。固定 `sleep` でテストを待たない(`dev-docs/TEST_RULE.md`)。macOS に `timeout` は無い
- `src/utils/` か `src/content/` を分割したら、`manifest` の `web_accessible_resources` を更新する(配布用 manifest は WXT が `wxt.config.ts` から生成する)

## 3. 検証コマンド

```bash
npm --prefix /Users/yaar/Playground/yasumaro run validate   # lint / 型 / docs 文字種 / 全テスト(約 90 秒)
npm --prefix /Users/yaar/Playground/yasumaro run build      # dist/chromium-mv3 を生成
```

- 直近の `validate` は全て通った(1363 ファイル、19162 テスト)。lint の警告 1 件(`readPathErrorPropagation.test.ts` の `no-greedy-fake-timers`)は既存のもの
- マシンが重いと、テストワーカーの起動タイムアウト(`Failed to start forks worker`)で失敗することがある。テスト自体が赤なわけではないので、残っているプロセスを確認して再実行する
- E2E は先に `build` が要る。手順は [handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md](handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md)

## 4. 現在の状態(2026-11-24 時点)

### 4.1 `1124a` に入っている変更(`main` より先、push 前)

| コミット | 内容 | PBI |
|---|---|---|
| 9a4590e4c | piiSanitizer の性能テスト閾値を 2000ms に緩和 | 11-23-01 |
| 64354e9b6 | ドメインポリシーと委譲フラグの読み手を blob 優先にした | 11-23-02 |
| 1265d3f72 | Obsidian の If-Match 競合検出と 412 の 1 回再書き込み | 11-23-04 |
| b76c618d0 | webhook 送信先の専用許可リストと保存時 pre-flight | 11-23-03 |
| 3e24592bb / e38df18f9 / d0478f5ae / 3070cef04 | refactor 4 件(閾値ループ、parseIntOr、listen、webhook 要素取得) | 11-21-04 / 02 / 01 / 03 |
| 6f12ae7fb | webhook export をサイドバーの In Development 区分へ移動 | 11-24-01 |
| 1a9a52c27 | リリース zip の SHA256SUMS と build provenance attestation | 11-24-03 |
| 6d39eb66e | README の Obsidian 競合の記述を If-Match に合わせた | 11-24-04 の一部 |
| 545b6be50 | webhook egress E2E を許可リストに追従 | 11-24-06 の一部 |

### 4.2 PBI 群と引き継ぎ文書

台帳、PBI 14 本、`pbi/handoff/` の 3 件、このファイルは、コミット 0103629d5 で `1124a` に入っている。未コミットのものは無い。

### 4.3 PBI の一覧と状態

| 順 | PBI | 状態 | 次にやること |
|---|---|---|---|
| 01 | [02 開発中機能の判定](2026-11-24-02-feat-ga-dev-feature-graduation.md) | 未着手 | 判定材料の収集と記録。**判定は owner の裁定** |
| 02 | [03 SHA256 と provenance](2026-11-24-03-release-artifact-provenance.md) | 実装済み | 実リリースで動作確認。[handoff](handoff/2026-11-24-03-release-artifact-provenance.md) |
| 03 | [04 リリース準備](2026-11-24-04-release-ga-preparation.md) | 一部 | 残りの文書更新。採番は 06・07 の後。[handoff](handoff/2026-11-24-04-release-ga-preparation.md) |
| 04 | [05 412 競合の通知](2026-11-24-05-feat-obsidian-conflict-user-notice.md) | 未着手 | 実装(推奨案は PBI 内) |
| 05 | [06 webhook E2E](2026-11-24-06-fix-webhook-egress-e2e-allowlist.md) | 一部 | 実 UI 経由の確認。[handoff](handoff/2026-11-24-06-fix-webhook-egress-e2e-allowlist.md) |
| 06 | [07 監査 run-3](2026-11-24-07-release-ga-security-audit-run3.md) | 未着手 | 04・05 の後に実施 |
| 07 | [08 実機スモーク](2026-11-24-08-release-ga-smoke-test.md) | 未着手 | 全コード変更の後の最終ゲート |
| 08 | [09 host_permissions](2026-11-24-09-fix-host-permissions-minimization.md) | 未着手 | 先に効果を確かめる(下記) |
| 09〜12 | [10](2026-11-24-10-backlog-e2e-encrypted-device-sync.md) / [11](2026-11-24-11-backlog-resummarize-past-records.md) / [12](2026-11-24-12-backlog-opt-in-anonymous-metrics.md) / [13](2026-11-24-13-backlog-other-note-app-export.md) | 将来候補 | 正式版リリース後に再検討 |

PBI 11-24-01(webhook のサイドバー区分)は完了済み。以前の 11-21 系 5 件のうち、11-21-05(settings form binding 採用、5 SP)だけが未着手で、GA の必須ではない。

## 5. 推奨する次の手順

1. (済)PBI 群と引き継ぎ文書のコミット(0103629d5)
2. 順位 04: PBI 11-24-05(412 競合の利用者通知)を実装する。小さく、他に依存しない
3. 順位 05: PBI 11-24-06 の残り(実 UI 経由の E2E)を片付ける
4. 順位 01: PBI 11-24-02 の判定材料を集めて owner に渡す(判定そのものは owner)
5. 順位 06: PBI 11-24-07 のセキュリティ監査 run-3(04・05 のコード変更が入った後に実施する)
6. 順位 03: PBI 11-24-04 の残り(SECURITY.md、CHANGELOG、掲載文)を、順位 01 の判定が出てから書く
7. 順位 07: PBI 11-24-08 の実機スモーク(最終ゲート)
8. 採番(7.0.0 案)とリリースは、6 と 7 が終わってから。owner の指示を待つ

## 6. 罠と注意(過去に実際に起きたこと)

- **サブエージェントの worktree は `main` から分岐する。** `1124a` にしかない実装(If-Match、webhook 許可リスト、blob-tier reader など)は入っていない。worktree で作業させるときは、プロンプトで `1124a` のコミットを cherry-pick させるか、`1124a` から分岐させる。結果は `git -C /Users/yaar/Playground/yasumaro cherry-pick <hash>` で `1124a` に取り込み、統合後に `validate` を通す
- **worktree にはコミットされていないファイルが入らない。** PBI ファイルは `1124a` 側にしか無いので、エージェントには絶対パスで読ませる
- **worktree では `npm run validate` が `sbom.json` の不足で `validate:json` で止まる。** 個別のコマンド(lint、type-check、type-check:test:baseline、check-i18n、check:docs-chars、全テスト)を実行させる。`.oxlintrc.json` は `npm run lint` が生成するので、先に lint を実行する
- **使い終わった worktree は、取り込み後すぐに片付ける。** 消す前に `git -C /Users/yaar/Playground/yasumaro cherry 1124a <ブランチ>` で、全コミットが `1124a` に取り込み済み(出力が `-` だけ)か確認する。`node_modules` はメインへのシンボリックリンクなので、`git worktree remove --force` で消してよい。作業用ブランチは `git branch -D` で消す
- 残してよい別件の worktree: `.worktrees/yasumaro-cli`(ブランチ `feature/yasumaro-cli`、owner の別作業)と、`~/.local/share/kilo/worktree-pool/` 配下(別ツールの管理)。触らない
- Edit のたびにフォーマッタ hook が走る。サブエージェントが触ったファイルは、Edit の前に再 Read する

## 7. owner の判断待ち(自分で決めない)

- 開発中の 4 機能(保存済みコレクション、履歴に聞く、調査レポート、webhook export)を正式版で昇格するか(PBI 11-24-02)
- 7.0.0 の位置付け(`docs/RELEASE_POLICY.md` には v6 系の方針しかない)
- リリース `.crx` を attestation の対象に含めるか(PBI 11-24-03)
- host_permissions の最小化を GA に含めるか、GA 直後にするか(PBI 11-24-09)。**content script が全サイトに一致するので、Chrome では必須権限を減らしても導入時の警告が変わらない可能性が高い。** 先に効果を確かめ、無ければ止める
- セキュリティ監査 run-1 の起点 `4790f224` はこのリポジトリの履歴に無い。PBI 11-24-07 に、代わりの起点としてコミット `a1e3ffb23`(run-1 台帳を追加したコミット)を使う案を書いた

## 8. 既知の食い違い・古い記述(直す対象)

- `AGENTS.md`(= `CLAUDE.md`)の Release 節にある「`manifest.json` の version bump」は古い。版の元は `package.json` で、`wxt.config.ts` が読み、`scripts/sync-version.mjs` が `docs/version.json` と `package-lock.json` を同期する。`cli/Cargo.toml` は手動。修正は PBI 11-24-04 の受け入れ基準
- webhook の説明が古い方式(「宣言されていない宛先は遮断」)のまま残っている箇所がある: `PERMISSIONS.md` の Reviewer Notes 2、`entrypoints/options/index.html` の `webhookExportDescription`、`src/dashboard/webhookExportSettings.ts` と `src/background/webhookExport/webhookExportPayload.ts` のコメント
- README の English 側には、Obsidian への追加の仕組みに当たる節が無い(日本語側は更新済み)
- `CHROMEWEBSTORE.md` の Target version は 6.9.75 のまま

## 9. 重要なファイルの場所

| 用途 | パス |
|---|---|
| 台帳(RICE と実行順) | `pbi/2026-11-24-00-backlog-ga-release.md` |
| PBI の索引(巨大、560KB。全体は読まない) | `pbi/00-INDEX.md` |
| プロジェクトの指示 | `CLAUDE.md`(= `AGENTS.md`)、`CLAUDE.local.md`、`CONTRIBUTING.md` |
| テスト規約 | `dev-docs/TEST_RULE.md`、`dev-docs/TESTING_GUIDE.md` |
| セキュリティ | `dev-docs/SECURITY_REVIEW_GUIDE.md`、`SECURITY.md`、`PERMISSIONS.md` |
| webhook 許可リスト | `src/background/webhookExport/webhookExportDestinations.ts` |
| Obsidian の条件付き書き込み | `src/utils/obsidianConditionalWrite.ts`、`src/background/obsidianClient.ts`、`src/background/pipeline/steps/saveToObsidianStep.ts` |
| サイドバーの区分 | `src/dashboard/panels/panelCatalog.ts`、`entrypoints/options/index.html` |
| リリースのワークフロー | `.github/workflows/release.yml`、`docs/RELEASE_VERIFICATION.md` |

## 10. 引き継ぎ時の最初の 3 手

1. `git -C /Users/yaar/Playground/yasumaro status --short` と `git -C /Users/yaar/Playground/yasumaro log --oneline -n 3` で、作業ツリーがきれいで、先頭が 0103629d5 以降であることを確認する
2. 台帳 `pbi/2026-11-24-00-backlog-ga-release.md` を読む
3. 5 の手順 2 から着手する(PBI 11-24-05 を読み、サブエージェントに実装させる。worktree の基点の罠に注意)
