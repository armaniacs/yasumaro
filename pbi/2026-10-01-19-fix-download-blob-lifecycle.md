# PBI: markdown テスト download の blob URL ライフサイクル修正

## 優先度・backlog 出所・依存

- 優先度: 中（RICE 8.0 — R 4 / I 2 / C 1.0 / Eff 0.5）
- backlog 出所: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) NN19（順位 12, fix）。バッチB で popup・connectionTests 側の並列候補（NN12, NN14 と同グループ）。
- 依存: なし。`src/dashboard/generalSettings/connectionTests.ts` とそのテストのみを触る。NN17 → NN20 の `generalSettingsPanel` チェーンとファイル非重複（wiring 側の `generalSettingsPanel.ts` は参照のみで変更しない）。

## ユーザーストーリー

ローカル Markdown 書き出しのテストボタンを使うユーザーとして、接続テストが失敗してもリソースがリークせず、テストの成否に関係なく同じライフサイクルで object URL が解放されてほしい。また、成功時のダウンロード開始を待つ固定タイマーに依存した不安定な解放ではなく、download の完了シグナルに連動した確実な解放であってほしい。

## 背景（file:line 付き現状）

- 対象は `src/dashboard/generalSettings/connectionTests.ts:404` の `handleTestLocalMarkdown(repo)`（export 済み、既定引数 `settingsRepository`）。所在は grep `handleTestLocalMarkdown` で確認済み。
- 現行の流れ:
  - `connectionTests.ts:447-448` — `new Blob([testContent], { type: 'text/markdown' })` → `const blobUrl = URL.createObjectURL(blob)`
  - `connectionTests.ts:452-459` — `await chrome.downloads.download({ url: blobUrl, filename, saveAs: false, conflictAction: 'overwrite' })`
  - `connectionTests.ts:461` — `setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)`（固定 1 秒 timer による解放）
  - `connectionTests.ts:465-467` — catch は status 表示のみで `URL.revokeObjectURL` を呼ばない
- 問題 1（リーク）: `chrome.downloads.download` が reject した場合、または `:454` の `resolveSafeExportDir(exportPath)` が throw した場合、catch path が revoke せず object URL がリークする。blob 生成（`:448`）より前の early return（`:420-423` の save 失敗、`:430-434` の disabled）ではリークしない。
- 問題 2（固定待ち）: `:461` の固定 1 秒 timer は「download が 1 秒以内に開始済みである」という仮定に依存する実時間待ちであり、AGENTS.md「Async / Timing Failures」の観点で promise 連動の解放に置き換えるべき形。production 側の待ち目的が実時間ではなくライフサイクル管理のため、完了シグナル連動で代替できる。
- wiring（参照のみ、変更しない）: `src/dashboard/panels/staticForm/generalSettingsPanel.ts:261`（`#testLocalMarkdownBtnTop`）, `:329`（`#testLocalMarkdownBtnBottom`）
- 既存テスト: `src/dashboard/generalSettings/__tests__/connectionTests.test.ts:999`（describe `handleTestLocalMarkdown`）, `src/dashboard/__tests__/exportDateSsot.golden.test.ts:222`, `src/dashboard/__tests__/localMarkdownExportTimingUi.test.ts`

## BDD

### Scenario: download 失敗時にも object URL が revoke される

- Given ローカル Markdown 書き出しが有効で `#testLocalMarkdownBtnTop` が存在する
- When `chrome.downloads.download` が reject する
- Then `URL.revokeObjectURL(blobUrl)` が失敗経路でも 1 回呼ばれる
- And status 表示は現行どおりエラーメッセージになる

### Scenario: 成功時は download の promise 解決に連動して revoke される

- Given `chrome.downloads.download` が正常に解決する
- When `handleTestLocalMarkdown` が完了する
- Then `URL.revokeObjectURL(blobUrl)` が promise 解決後に 1 回呼ばれる
- And `setTimeout` による固定 1 秒待ちは実装から消えている

## 実装宣言・受け入れ基準

It must keep behavior: download の成功・失敗に関係なく、status 表示・ボタン再有効化（`finally` の `testLocalMarkdownBtn.disabled = false`）・filename 組立（`resolveSafeExportDir` と `conflictAction: 'overwrite'`）の UI 挙動は現行どおりであること。変更は object URL の解放タイミングと成功/失敗両経路での解放保証に限る。

- [x] 失敗時（`chrome.downloads.download` の reject、`resolveSafeExportDir` の throw 含む）にも `URL.revokeObjectURL` が呼ばれる
- [x] 固定 1 秒 timer（`connectionTests.ts:461`）が廃止され、revoke が download promise の解決に連動する
- [x] 成功時の UI 挙動（成功メッセージ・class 付与・ボタン再有効化）は不変
- [x] 失敗時の UI 挙動（エラーメッセージ・class 付与）は不変
- [x] 既存テスト green（テストは実時間待ちに依存しない）

## テスト戦略

- `src/dashboard/generalSettings/__tests__/connectionTests.test.ts` の describe `handleTestLocalMarkdown`（`:999`）に追加:
  - `URL.createObjectURL` / `URL.revokeObjectURL` を mock し、`chrome.downloads.download` を reject させて revoke 呼び出しを検証する
  - resolve 経路で revoke が 1 回呼ばれることを検証する
  - 完了は `await handleTestLocalMarkdown(repo)` で待ち、`setTimeout` の実時間待ちは使わない（[TEST_RULE](../dev-docs/TEST_RULE.md)。`useTimerClock()` や injected sleep ではなく、revoke を promise 連動にしたことで mock の呼び出しを同期的に検証できる）
- regression ゲート: `connectionTests.test.ts`, `src/dashboard/__tests__/exportDateSsot.golden.test.ts`, `src/dashboard/__tests__/localMarkdownExportTimingUi.test.ts`
- 定義済み DoD に従い、`npx vitest run <file> --repeats=20` で flake がないことを確認する

## 実装内容

1. `handleTestLocalMarkdown` 内、`URL.createObjectURL(blob)`（`connectionTests.ts:448`）以降の download 実行を try/finally で包む:
   - try: `await chrome.downloads.download({ url: blobUrl, filename: ..., saveAs: false, conflictAction: 'overwrite' })` と成功 status 表示
   - finally: `URL.revokeObjectURL(blobUrl)`
2. `:461` の `setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)` を削除する。
3. catch は現行の status 表示のみに留め、revoke は finally に一本化する（catch 内の個別 revoke は finally が両経路をカバーするため不要。revoke を catch にも書く方式ではなく finally 集約とする）。
4. revoke の適用範囲は blobUrl 生成後のブロックに限定し、blob 生成前の early return（`:420-423`, `:430-434`）では undefined に対する revoke が発生しないようにする。
5. 変更は `src/dashboard/generalSettings/connectionTests.ts` とそのテストに留める。wiring 側（`generalSettingsPanel.ts`）・`resolveSafeExportDir`・`saveDashboardSettings` には触れない。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] 失敗経路・成功経路の両テストが追加され、`npx vitest run <file> --repeats=20` で flake なし
- [x] `git diff` が `src/dashboard/generalSettings/connectionTests.ts` とそのテストのみに留まっている
- [x] `setTimeout` による固定待ちがソースから消えている（`grep 'revokeObjectURL' src/dashboard/generalSettings/connectionTests.ts` で timer 経由の呼び出しが残っていないこと）
- [x] コードコメントは非自明な WHY のみ（CLAUDE.md 規約）

## 実装記録（2026-10-02）

### 変更点

- `src/dashboard/generalSettings/connectionTests.ts` の `handleTestLocalMarkdown` — `URL.createObjectURL(blob)` 以降の download 実行と成功 status 表示を try で包み、`finally` で `URL.revokeObjectURL(blobUrl)` する形に変更。`setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)` を削除した。成功・失敗・サニタイザの throw のいずれでも revoke される。
- catch は従来どおり status 表示のみに留め、revoke は `finally` に一本化している（`実装内容` 3 の方針どおり）。revoke の適用範囲は blobUrl 生成後のブロックに限っており、生成前の early return では undefined に対する revoke は発生しない。
- `resolveSafeExportDir` / `saveDashboardSettings` / wiring 側（`generalSettingsPanel.ts`）は未変更。

### なぜ遅延なしで安全か

- `chrome.downloads.download` の promise は `DownloadItem::Start()` がリクエストを生成した後に解決するため、解決時点で blob の fetch は既に始まっている。
- File API は進行中の fetch に対して blob を生存させ続ける。`revokeObjectURL` が禁じるのは**後続**の fetch だけなので、完了シグナルに連動した revoke で問題ない。
- 対照: `exportLogsService.downloadBlob` は anchor click で開始し完了シグナルが無いため、まだ 60 秒の遅延が必要。この 2 つの違いが「一律に timer を残す」判断と「finally に一本化」判断を分けている。

### 追加・更新したテスト

- `src/dashboard/generalSettings/__tests__/connectionTests.test.ts` の describe `handleTestLocalMarkdown` を更新。`URL.createObjectURL` / `URL.revokeObjectURL` を mock し、resolve 経路で revoke が 1 回呼ばれること、reject 経路とサニタイザ throw 経路でも revoke されることを検証する。`useTimerClock()` や injected sleep ではなく、revoke が promise 連動になったことで mock の呼び出しを同期的に検証できる。
- 検証: `grep -n 'revokeObjectURL' src/dashboard/generalSettings/connectionTests.ts` → `:469` の 1 件のみ（`finally` 内）。timer 経由の呼び出しは残っていない。
- `npx vitest run <batch-B の 11 ファイル> --repeats=20` → 11 files / 301 tests 全回 green。`npm run validate` も green。

### 今後のメモ

- `src/dashboard/markdownExport.ts:285` には**本番の日次ノート export 経路**に固定 1 秒の revoke timer が残っている。今回の許可範囲外であり触っていない。production の export は上記 `exportLogsService.downloadBlob` と同じ「完了シグナルがない」型なので、`finally` 化には download 開始の完了シグナルか別の解放戦略が必要。
