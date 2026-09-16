# PBI: 閲覧ログエントリ→Markdown 生成の SSOT 統合

優先度: 順位 3 / 10（RICE: 5.33 = Reach 10 / Impact 2 / Confidence 0.8 / Effort 3 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: pbi/2026-09-17-03-refactor-obsidian-sync-dead-code.md を先に完了すること（削除対象の重複箇所を減らすため）

## ユーザーストーリー
拡張機能を保守する開発者として、閲覧ログエントリから Markdown を生成する際のサニタイズ列を `src/utils/markdownFormatter.ts` の単一関数に集約してほしい、なぜなら同一のセキュリティ知識（リンク脱出・wikilink 注入対策のサニタイズ適用順序）が複数ファイルに分散していると、対策強化時の適用漏れがそのままインジェクション欠陥になるから。

---

## 背景（現状と課題）
Markdown リンク脱出対策のサニタイズ列（`sanitizeForMarkdownLinkText` → `sanitizeUrlForMarkdownTarget` → `sanitizeForObsidian` の適用順序）が複数ファイルに重複している。該当箇所はいずれも実在を確認済みである（以下、行番号ではなく関数名と概略位置で示す）。

1. `formatMarkdownStep`（`src/background/pipeline/steps/` 配下） — リスト形式 `- HH:MM [title](url)\n    - summary` を組み立てる。タグがある場合は `#` 付きプレフィックスを付ける。この形式は `src/utils/markdownFormatter.ts` の `formatSingleEntry()` とほぼ逐語重複であり、差は timestamp の出所（現在時刻かエントリの `created_at` か）と tags の有無のみである。
2. `formatSingleEntry()`（`src/utils/markdownFormatter.ts` 内の非公開関数。`formatEntriesToMarkdown()` 経由で公開） — 同じリスト形式を独自実装している。`formatEntriesToMarkdown()` は `src/background/handlers/dashboardSqlite/` 配下の append 系ハンドラから `deps.ts` の注入経由で使用され、`src/dashboard/obsidianFormatter.ts` が re-export している。
3. `formatEntryToMarkdown()`（`src/utils/markdownFormatter.ts`） — 見出し形式を独自実装している。`src/utils/copyMarkdownButton.ts` が使用している。
4. `toMarkdownTemplateEntryData()`（`src/dashboard/markdownExport.ts`） — 見出し＋タグ形式向けのエントリデータ組み立てを独自実装している。
5. `sync()` 内の `defaultEntry()` クロージャ（`src/background/syncTargets/gistSyncTarget.ts`） — 1行形式 `- [title](url): summary` を独自実装している。

なお `src/background/obsidianSyncService.ts` の `sync()` 付近にも同一サニタイズ列が存在するが、これは依存 PBI（03）の削除対象であり、本 PBI 着手時には消滅している前提である。03 を先に完了させることで、本 PBI が扱う重複箇所は上記 5 件に絞られる。

影響: 同一のセキュリティ知識が分散しているため、過去 VULN-001/004/008 のような対策強化時に適用漏れが即インジェクション欠陥になる。`markdownJoinSafety.test.ts` が呼び出し元ごと（`formatMarkdownStep`／`formatEntryToMarkdown`／`ObsidianSyncService`／`GistSyncTarget`）に個別テストしていること自体が重複の証拠である。

対応方針: `src/utils/markdownFormatter.ts` に `buildEntryMarkdown(input, style)` を新設し、サニタイズ順序を唯一ここで所有する。形式差は引数化する。`formatMarkdownStep`／`formatEntriesToMarkdown`／`markdownExport`／`gistSyncTarget` の各生成箇所は委譲に置換する。

制約: 出力は現行と完全一致（byte-identical）にすること。本 PBI は統合のみで挙動変更はしない。一致検証は parity テストで行う。

---

## BDD受け入れシナリオ
```gherkin
Scenario: 置換前後で生成 Markdown が byte-identical である（parity）
  Given 既存の5呼び出し元（formatMarkdownStep／formatEntriesToMarkdown／formatEntryToMarkdown／markdownExport／gistSyncTarget の defaultEntry）が存在する状態
  When  各生成箇所を buildEntryMarkdown への委譲に置換する
  Then  同一入力に対する生成 Markdown が置換前と byte-identical である（parity テストで pin されている）

Scenario: 脱出文字を含むタグが obsidianList スタイルで無害化される（境界）
  Given タグに ](url) 脱出文字を含む入力が存在する
  When  obsidianList スタイルで Markdown を生成する
  Then  タグはサニタイズ後に #tag として付与され、Markdown リンク脱出が起きない
```

## 受け入れ基準
- [ ] `src/utils/markdownFormatter.ts` に `buildEntryMarkdown(input, style)` が新設され、サニタイズ適用順序を唯一ここで所有している
- [ ] 4箇所（`formatMarkdownStep`／`formatEntriesToMarkdown`／`markdownExport`／`gistSyncTarget`）が `buildEntryMarkdown` への委譲に置換され、重複実装が削除されている
- [ ] 同一入力に対する生成 Markdown が置換前と byte-identical である（parity テストで全スタイルを pin）
- [ ] 本 PBI による挙動変更がない（統合のみ。出力差分ゼロ）
- [ ] 既存テスト（`markdownJoinSafety.test.ts`／`markdownFormatter.test.ts`／`formatMarkdownStep` 系／dashboardSqlite の append 系ハンドラ）が green のままである
- [ ] `npm run type-check`／`npm run lint`／`npm test` が green である

## テスト戦略
- parity テスト: 各呼び出し元・各スタイルについて、置換前の出力を期待値として pin し、委譲置換後も byte-identical であることを検証する（タグ有無・summary の区切り・timestamp 出所の違いを網羅）
- 境界テスト: タイトル・タグ・URL に `](url)` 脱出文字や wikilink 注入片を含む入力を与え、リンク脱出が起きないことを検証する（既存 `markdownJoinSafety.test.ts` の観点を SSOT 経由に寄せ、呼び出し元ごとの重複テストは整理する）
- 既存スイートの維持: `markdownFormatter.test.ts`、`formatMarkdownStep` 系テスト、dashboardSqlite append 系ハンドラのテストを green のまま保つ

## 見積もり
3 pt（ヘッダの RICE Effort と一致）。範囲は 4 呼び出し元の委譲置換と parity テスト整備であり、新規挙動の追加はない。

## 実装ガイド

### 形式差の吸収方法（設計案）
`buildEntryMarkdown(input, style)` の `style` は `'obsidianList' | 'plainLine' | 'heading'` とし、呼び出し元ごとの形式差はオプションに切り出す。

| 呼び出し元（関数名＋概略位置） | style | 吸収すべき差 |
|---|---|---|
| `formatMarkdownStep`（pipeline steps 配下） | `obsidianList` | timestamp 出所＝現在時刻、tags の `#` prefix 有り、summary の区切りは `\n    - ` |
| `formatEntriesToMarkdown`（`markdownFormatter.ts`。`formatSingleEntry` 経由） | `obsidianList` | timestamp 出所＝append 時刻（`Date.now()` 由来）、tags 無し |
| `formatEntryToMarkdown`（`markdownFormatter.ts`。`copyMarkdownButton.ts` が使用） | `heading` | 見出し形式。tags はカンマ区切り文字列を分割して `#` prefix 付きで列挙 |
| `toMarkdownTemplateEntryData`（`dashboard/markdownExport.ts`） | テンプレート向けエントリデータ | timestamp 出所＝エントリの `created_at`、tags の `#` prefix 有り。テンプレート描画自体は `renderFileTemplate` に残す |
| `defaultEntry` クロージャ（`gistSyncTarget.ts` の `sync` 内） | `plainLine` | 1行形式 `- [title](url): summary`。timestamp・tags 無し |

オプション化する軸: timestamp の出所（現在時刻／append 時刻／エントリの `created_at`／無し）、tags の `#` prefix 有無と区切り文字、summary の区切り記号。

### 着手時の注意
- 読み取りで確認した限り、呼び出し元ごとにサニタイズ鎖の細部が微妙に異なる（例: タグ側の鎖、`formatEntryToMarkdown` 付近の URL 側の扱い）。統一ではなく現行出力の再現が正であるため、各呼び出し元の現行出力を parity テストで先に pin してから委譲に置換し、差分が出たらオプション側で吸収すること。
- 依存 PBI（03）の完了を前提とする。`obsidianSyncService` 分の重複が残っている状態では着手しないこと。
- 確認ポイント: 上記 5 ファイル、`markdownJoinSafety.test.ts`、`markdownFormatter.test.ts`、dashboardSqlite の append 系ハンドラ（`deps.ts` の `formatEntriesToMarkdown` 注入）。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] 置換前後の出力 byte-identical を parity テストで確認済み
