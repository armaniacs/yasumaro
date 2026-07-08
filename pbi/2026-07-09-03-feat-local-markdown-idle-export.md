# PBI: ローカル Markdown 書き出しをアイドル時に一括実行

## ユーザーストーリー
ローカル Markdown 書き出しを有効にしているユーザーとして、1 録画ごとではなくブラウザがアイドル状態になったタイミングで 1 日分の Markdown が 1 回だけ書き出されることを望む。なぜなら現状は録画完了のたびに `chrome.downloads.download` が発火してダウンロードバーが連打され、さらにその日の全エントリを毎回まるごと再ダウンロードするため書き込み量が O(n²) になり、dataURL の 2MB 上限にも到達しうるから。

## ビジネス価値
- ダウンロード UI の連打による UX 劣化を解消する
- O(n²) の再ダウンロードをなくし、保存処理のコストを定数化する
- 2MB 上限への到達を回避（1 日 1 回の書き出しでも上限は残るが、頻度が激減）

## 既実装確認（Phase 0）
- `grep -rn "chrome.downloads.download" src/background` → `saveLocalMarkdownStep.ts:93` のみ。毎録画発火を確認
- `grep -rn "chrome.idle" src/` → ヒットなし（idle 検知は未実装）。`recordingTriggerManager.ts` の `scroll_idle` は別概念
- `LOCAL_MARKDOWN_EXPORT_ENABLED` / `_AUTO_ENABLED` / `_PATH` は `storage/types.ts` / `defaults.ts` に定義済み
- `saveLocalMarkdownStep.ts` は既に `chrome.storage.local` の `local_export_YYYY-MM-DD` バッファへ追記している → バッファリング部分は再利用可能

## BDD受け入れシナリオ

```gherkin
Scenario: 1 日に複数録画しても書き出しはアイドル時に 1 回だけ
  Given ユーザーがローカル Markdown 書き出し（自動）を有効にしている
  And その日すでに 5 件の録画がバッファに蓄積している
  When ブラウザの状態が "idle" になる
  Then その日の Markdown ファイルが 1 回だけダウンロードされる
  And 録画ごとにダウンロードが発火しない

Scenario: 自動書き出しが無効ならアイドル時も書き出さない
  Given ユーザーがローカル Markdown 書き出しを無効にしている
  When ブラウザが idle になった
  Then ダウンロードは一切発生しない

Scenario: 常時アクティブ環境でも一定時間で書き出される
  Given ユーザーが自動書き出しを有効にしている
  And ブラウザが "active" のまま 30 分経過した
  When フォールバックの定期フラッシュが実行される
  Then バッファの Markdown が 1 回ダウンロードされる
```

## 受け入れ基準
- [ ] `saveLocalMarkdownStep` はダウンロードを行わず、バッファ（`local_export_YYYY-MM-DD`）への追記のみを行う
- [ ] Service Worker に `chrome.idle.onStateChanged` リスナーを追加し、状態が `idle` になったら未フラッシュの日別バッファを 1 回ダウンロードする
- [ ] 自動書き出し無効時はフラッシュしない
- [ ] `chrome.idle` が発火しない環境へ備え、30 分ごとの `chrome.alarms` フォールバックで同フラッシュを行う（重複書き出しは `conflictAction:'overwrite'` で安全）
- [ ] `chrome.downloads.download` は `saveAs:false` かつ `conflictAction:'overwrite'` を維持

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 見送り（`chrome.idle` / `chrome.downloads` の E2E fixture なし）

### 統合テスト
- `saveLocalMarkdownStep` 実行後に `chrome.downloads.download` が呼ばれずバッファのみ更新されること
- アイドル flush ハンドラが `chrome.downloads.download` を 1 回呼ぶこと（モックで検証）

### 単体テスト
- `saveLocalMarkdownStep`: autoExport 無効 → スキップ；有効 → バッファ追記のみ（download 呼ばれず）
- idle ハンドラ: `local_export_*` バッファあり → download 1 回；バッファなし → 何もしない
- フォールバックアラムハンドラ: 同様のフラッシュ動作

## 実装アプローチ
- **Outside-In**: 統合テスト（ステップが download しない／idle ハンドラが download する）を先に失敗させ、単体から実装
- **Red-Green-Refactor**: バッファリング維持 → idle ハンドラ → アラムフォールバックの順

## 見積もり
5 pt（idle/alarms ハンドラ新規、既存ステップの改修）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `chrome.downloads.download` / `chrome.idle` / `chrome.alarms` を `vi.mock` でモック。`saveLocalMarkdownStep` は既に `chrome.storage.local` を使うため、バッファ読み書きは既存モックを流用
- 非機能要件: アイドル検知の閾値は `chrome.idle.setDetectionInterval`（既定 60 秒）。フォールバックアラムは 30 分
- `chrome.idle` は権限不要だが、SW 再起動時にリスナーを再登録すること（エフェメラル SW 対応）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "chrome.downloads.download" src/background
# → src/background/pipeline/steps/saveLocalMarkdownStep.ts:93
grep -rn "chrome.idle" src/  # ヒットなし（新規）
grep -rn "LOCAL_MARKDOWN_EXPORT" src/utils/storage/types.ts
# → ENABLED / AUTO_ENABLED / PATH 定義済み
```

### 実装手順
1. `saveLocalMarkdownStep.ts` から `chrome.downloads.download` 呼び出しを削除し、バッファ追記のみにする（既存の `chrome.storage.local` 追記ロジックを残す）
2. 新規 `src/background/localMarkdownIdleFlusher.ts` を作成:
   - `flushPendingExports()`: `chrome.storage.local` の `local_export_*` キーを走査し、エントリ非空の日付ごとに `buildDailyMarkdown` + `chrome.downloads.download` を 1 回実行
   - `initIdleFlush()`: `chrome.idle.onStateChanged.addListener(state => { if (state === 'idle') flushPendingExports(); })` と、30 分ごとの `chrome.alarms` フォールバックを登録
3. `service-worker.ts` の起動処理で `initIdleFlush()` を呼ぶ
4. テスト追加（download / idle / alarms をモック）

### 落とし穴
- Service Worker はエフェメラル。`chrome.idle.onStateChanged` は SW 起動中しか受け取れないため、フォールバックの `chrome.alarms`（30 分）は必須
- `local_export_*` バッファは毎録画追記されるため、flush 後にバッファをクリアするか、重複書き出しを `conflictAction:'overwrite'` で吸収する（クリアしない方が安全：未フラッシュ検知が単純）
- dataURL 2MB 上限は 1 日 1 回でも残る。極長日文は今回のスコープ外とするが、コメントで言及

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 録画ごとのダウンロードが廃止され、idle / アラムで 1 日 1 回になる
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載
