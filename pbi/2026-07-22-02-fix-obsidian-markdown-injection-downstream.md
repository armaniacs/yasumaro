# PBI: Obsidianマークダウン注入 — 派生サーフェス（Vault追記・ローカルエクスポート・ダッシュボードリンク表示）の修正

## ユーザーストーリー
拡張機能の利用者として、ダッシュボードから「Obsidianへ追記」機能やローカルMarkdownエクスポート機能を使ったとき、あるいはダッシュボードの履歴一覧で記録済みURLをクリックしたときに、悪意あるページ由来のデータによってVaultの汚染やタブ乗っ取り（tabnabbing）が起きないことを望む。なぜなら、これらの機能は前提PBI（PBI A）とは異なる独自のコードパスを持ち、PBI Aの修正だけではカバーされないためである。

## ビジネス価値
- **セキュリティ**: PBI Aと同じ根本原因（未サニタイズのurl/titleがMarkdownリンクに混入）を持つが、独立した3つのコードパス（`obsidianFormatter.ts`, `dashboard.ts`, `sqliteHistoryPanel.ts`）を個別に閉じる。特に `obsidianFormatter.ts` はサービス資格情報（Obsidian APIキー）を使ってVaultへ書き込む経路であり、監査でHigh severityと判定された
- **信頼性**: PBI A実装後もこれら3経路が残っていると「一部は直ったが他は直っていない」という不完全な修正状態になる

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-007 | CWE-79 | **High** | `src/dashboard/obsidianFormatter.ts` の `formatSingleEntry()` が `title`/`summary` はサニタイズするが `url` を一切サニタイズせず、サービス資格情報（Obsidian APIキー）を使うVault書き込みに到達する | `poc/VULN-007_obsidian_formatter_url_injection.md` | `exploit_tests/test_vuln_007_obsidian_formatter_url_injection.test.ts` |
| VULN-020 | CWE-79 | Medium | `src/dashboard/dashboard.ts` の `formatEntryToMarkdown`（519行目、独自実装）が `title`/`url` を一切サニタイズせず、`src/utils/markdownFormatter.ts` の安全な実装をインポートしていない | `poc/VULN-020_dashboard_local_export_unsanitized_title_url.md` | `exploit_tests/test_vuln_020_dashboard_local_export_unsanitized.test.ts` |
| VULN-006 | CWE-601/CWE-1022 | Medium | `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:663` の `<a href>` がスキーム未検証（`data:`等）かつ `rel="noopener noreferrer"` が無い。オープンリダイレクト兼リバースタブナビング | `poc/VULN-006_dashboard_href_open_redirect_tabnabbing.md` | `exploit_tests/test_vuln_006_dashboard_href_tabnabbing.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: 「Obsidianへ追記」でVaultに書き込まれるURLがサニタイズされる（VULN-007）
  Given ダッシュボードのSQLite履歴に、url が "https://x) \n\n![evil](https://attacker/track.png)\n\n[click me](https://phish.example" というレコードが（インポート等で）存在する
  When 利用者がこのレコードを選択し「Obsidianへ追記」操作を実行する
  Then Obsidian Local REST API へ送信されるMarkdown本文に、独立した "![evil](...)" や "[click me](...)" ノードが含まれない
  And 元の title・summary は引き続き正しく表示される

Scenario: ローカルMarkdownエクスポートが通常記録のtitle/urlもサニタイズする（VULN-020）
  Given 攻撃者が document.title を "Deal ![[Passwords]]" に設定したページを利用者が通常のブラウジングで訪問し記録された
  When 利用者がダッシュボードの「ローカルMarkdownエクスポート」ボタンを押す
  Then 出力されたMarkdownファイルの該当行に "![[Passwords]]" が生きた埋め込み構文のまま出力されない
  And PBI Aで安全性が確認された `sanitizeForObsidian`（または同等ロジック）がこの経路でも適用されている

Scenario: 履歴一覧のリンクは安全なスキームのみナビゲート可能で新規タブはopenerを持たない（VULN-006）
  Given SQLite履歴に url が "data:text/html,<script>...</script>" のレコードが（インポート等で）存在する
  When 利用者がダッシュボードの履歴一覧でこのエントリのタイトルリンクをクリックする
  Then ブラウザは data: スキームへナビゲートしない（http/https以外は無効化されるか、安全なフォールバック先が使われる）
  And リンクに rel="noopener noreferrer" が付与されており、開いた新規タブから window.opener 経由で元のダッシュボードタブを操作できない
```

## 受け入れ基準
- [ ] `src/dashboard/obsidianFormatter.ts` の `formatSingleEntry()` で `entry.url` がMarkdownリンクに埋め込まれる前にサニタイズされる（PBI Aで整備した仕組みを再利用）
- [ ] `src/dashboard/dashboard.ts` の `formatEntryToMarkdown` が、独自の未サニタイズ実装を廃止し、`src/utils/markdownFormatter.ts` の安全な実装を呼び出す（または同等のサニタイズを適用する）ように変更される
- [ ] `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:663` の `<a href>` が、既存の `isSecureUrl()` ヘルパーでスキーム検証されたURLのみを実際のhrefとして使用する（不正なスキームの場合は `#` 等の安全なフォールバック）
- [ ] 同じ `<a>` タグに `rel="noopener noreferrer"` が無条件で付与される
- [ ] （defense-in-depth・任意）`src/background/handlers/dashboardSqliteHandlers.ts` のインポート/リストアパスで、URLスキームの事前検証を追加する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意）Playwrightで悪意あるレコードをインポート → ダッシュボード履歴一覧でリンクの `href`/`rel` 属性を検査するシナリオ

### 統合テスト
- [ ] `src/dashboard/__tests__/` 配下、`append_to_obsidian` サブタイプの処理経路（`dashboardSqliteHandlers.ts` → `obsidianFormatter.ts`）を通した統合テストで、悪意あるurlが最終Markdownに漏れないことを確認

### 単体テスト
- [ ] `src/dashboard/obsidianFormatter.ts` 用の単体テスト（現状専用テストファイルが無いため新規作成、VULN-007のPoCペイロードを使用）
- [ ] `src/dashboard/__tests__/dashboard.test.ts` に `formatEntryToMarkdown` のサニタイズ確認テストを追加（VULN-020のPoCペイロードを使用）
- [ ] `src/dashboard/panels/__tests__/` 配下、`sqliteHistoryPanel` のhref生成ロジックに対するスキーム検証・rel属性のテストを追加（VULN-006のPoCペイロードを使用）

## 実装アプローチ
- **前提**: 本PBIはPBI A（`sanitizeForObsidian`のscheme-agnostic化）の完了を前提とする。PBI Aが未完了の場合、VULN-007/020の修正も同じ根本原因を再度個別に直す形になり非効率
- **Outside-In**: 各VULNのexploit testを参考にRED状態を先に作ってから実装する
- **Red-Green-Refactor**: VULN-007 → VULN-020 → VULN-006 の順（サービス資格情報が絡むHigh severityのVULN-007を最優先）

## 見積もり
4pt（3ファイル・3つの独立した小さな修正だが、それぞれ専用テストの新規作成が必要なため）

## 技術的考慮事項
- 依存関係: PBI A完了後に着手することを推奨（`sanitizeForObsidian`等の共有ロジックを前提とする）
- VULN-006はMarkdown注入ではなくHTML属性（href/rel）の問題であり、他の2件と技術的な直し方が異なる点に注意
- `dashboard.ts`の`formatEntryToMarkdown`を削除して`markdownFormatter.ts`を使う場合、出力フォーマットの差異（タイムスタンプ形式等）がないか既存のエクスポート機能の見た目に影響しないか確認する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下の行番号が該当することを確認済み）
```bash
grep -n "const url = entry.url\|sanitizeForObsidian(entry.title" src/dashboard/obsidianFormatter.ts
grep -n "function formatEntryToMarkdown\|^import" src/dashboard/dashboard.ts
grep -n 'target="_blank"' src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
```

### 実装手順
1. `obsidianFormatter.ts:26` の `const url = entry.url;` を、PBI Aで整備したURL向けサニタイズ関数を通す形に変更する
2. `dashboard.ts:519` の `formatEntryToMarkdown` を、`src/utils/markdownFormatter.ts` の既存実装をインポートして置き換える（`grep -n "^import" dashboard.ts` で現状インポートされていないことを確認済み）
3. `sqliteHistoryPanel.ts:663` の `<a href="${escapeHtml(entry.url)}" ...>` を、`isSecureUrl(entry.url) ? entry.url : '#'` のようなスキームガードでラップし、`rel="noopener noreferrer"` を追加する

### 落とし穴
- `dashboard.ts`の独自`formatEntryToMarkdown`を削除する際、呼び出し元（`exportLocalMarkdownCore`）が期待する関数シグネチャ（引数の型）が`markdownFormatter.ts`側と異なる可能性がある。型を合わせるか、薄いアダプタ関数を挟むこと
- `sqliteHistoryPanel.ts`でスキームを`#`にフォールバックする場合、クリックしても何も起きないだけでなく、利用者に「このURLは無効です」等のフィードバックがあるとUXが良い（必須ではない）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `exploit_tests/test_vuln_006_dashboard_href_tabnabbing.test.ts`, `test_vuln_007_obsidian_formatter_url_injection.test.ts`, `test_vuln_020_dashboard_local_export_unsanitized.test.ts` の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する
