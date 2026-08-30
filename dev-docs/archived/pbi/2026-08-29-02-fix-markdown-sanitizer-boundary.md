# PBI: Markdown/Obsidian 出力サニタイズ境界の確立（VULN-001/008/047, CWE-79）

## ユーザーストーリー
利用者として、訪問したページの内容が Obsidian 日次ノートやローカル markdown エクスポートに安全に書かれるようにしたい、なぜならページ由来の生 HTML（`<img onerror>` 等）が「サニタイズ済み」を名乗る境界を素通りし、ノート内で実行・偽装リンクになるから

## 現状（着手前に確認すること）
前回の adversarial review 対応で `src/utils/markdownSanitizer.ts` に以下が既に実装・一部配線済み:
- `sanitizeForMarkdownLinkText`（`[ ] ( )` を `\[` `\]` `\(` `\)` にエスケープ。VULN-001/016/017 コメント付き）
- `sanitizeUrlForMarkdownTarget`（URL 側のブレイクアウト防止）

配線済み: `formatMarkdownStep.ts` の **タイトル**、`markdownFormatter.formatEntryToMarkdown` の **タイトル/URL**。

**未対応（本 PBI の残タスク）**:
1. `sanitizeForObsidian` は依然として `<`/`>`/`&` を素通し（VULN-001 の生 HTML）。実装は `sanitizeAllMarkdownLinks` + `escapeObsidianWikilinks` のみで HTML エンティティ化なし
2. **タグ**は全消費者で `sanitizeForObsidian(t)` のみ（`[ ] ( )` 非エスケープ）→ `foo](url)` 型のタグ断片が summary 行を破壊しうる（VULN-008/047）
3. `markdownFormatter.formatEntryToMarkdown` の legacy 版（`markdownFormatter.ts:5`）はタイトルに `sanitizeForObsidian` を使用（link-text ヘルパー未適用）
4. `obsidianSyncService.ts:62` / `syncTargets/gistSyncTarget.ts:49` はタイトルを `[${sanitizeForObsidian(title)}](...)` で埋め込み（link-text ヘルパー未適用。現在は死蔵ではなく実行経路）

## ビジネス価値
- Medium 脆弱性（VULN-001）の解消: `sanitizeForObsidian` が HTML を通す（payload が verbatim でノートに到達）
- VULN-008/047 の解消: タグ断片が join 境界で `[ #bar](https://evil.com)` に再構成されうる
- 測定方法: `sanitizeForObsidian('<img src=x onerror=alert(1)>')` が HTML をエンティティ化すること、タグ経路の join 出力に生リンク構文が形成されないこと

## 優先度
- 順位: 2 / 14
- RICEスコア: 4750（Reach=1000 / Impact=0.5 / Confidence=95% / Effort=0.1人月）
  - Reach 1000: ページ→ノート経路は全 Obsidian 連携ユーザーに到達（録画は既定動作）
  - Impact 0.5: Medium。ノート内 HTML 実行は Obsidian レンダラ次第だが、偽装リンク・構造汚染は確実
  - Confidence 95%: link-text ヘルパーは既存・テスト済み。残るは境界関数へのエンティティ化追加＋適用漏れ 4 箇所
  - Effort 0.1: エンティティ化 1 箇所＋タグ/legacy/sync-target の適用＋回帰テスト（当初 0.2 から半減 — ヘルパー新設が不要になったため）
- 根拠: 前回レビューで link-text ヘルパーが導入済み。残タスクは「エンティティ化」と「適用漏れの解消」に限定される
- 注: `2026-08-29-00-backlog-vulnhunt-audit.md` の当初スコアは 2375（Effort 0.2）。実装済み部分を除いた再評価で Effort 半減・スコア 4750 相当。着手順は 2 番目のまま（01 と同帯だが 01 の ReDoS が拡張全体停止で先着）

## BDD受け入れシナリオ

```gherkin
Scenario: 生 HTML はエンティティ化されてノートに書かれる
  Given ページ要約に "<img src=x onerror=alert(1)>" が含まれる
  When formatMarkdownStep がノート本文を生成する
  Then HTML は <img ...> 形式でエンティティ化され、タグとして解釈可能な文字列は存在しない

Scenario: タグ断片の結合でリンク構文は再構成されない
  Given タグ "foo [" と "bar](https://evil.example)" が与えられる
  When タグ行を結合する
  Then 各断片が結合安全にエスケープされ、バランスした markdown リンクが形成されない

Scenario: 正当な markdown 出力は現行と同じ見た目を保つ（回帰防止）
  Given 通常のタイトル・URL・要約・タグが与えられる
  When ノート本文を生成する
  Then 既存テストの期待出力と一致する（エスケープは記号にのみ影響）

Scenario: クリップボード出力も同一境界を通る
  Given 同一の悪意あるタグ断片が与えられる
  When formatEntryToMarkdown（clipboard）が実行される
  Then 共有ヘルパーを経由し、ノート出力と同一のエスケープ結果になる
```

## 受け入れ基準
- [ ] `src/utils/markdownSanitizer.ts` の `sanitizeForObsidian` が、既存のリンク/wikiリンク エスケープに加え `<`→`&lt;` / `>`→`&gt;` / `&`→`&amp;` をエンティティ化する（`&amp;` の二重エンコード回避に注意）
- [ ] 既存 `sanitizeForMarkdownLinkText` が `[...]` 埋め込み位置の全消費者で使われている: `markdownFormatter.ts` の legacy `formatEntryToMarkdown`（タイトル）、`src/background/obsidianSyncService.ts`（タイトル）、`src/background/syncTargets/gistSyncTarget.ts`（タイトル）
- [ ] タグ断片が summary 行に連結される経路（`formatMarkdownStep.ts` / `markdownFormatter.ts` の `#${tag}` 生成箇所）で、タグにも `sanitizeForMarkdownLinkText` 相当の `[ ] ( )` 無効化が適用されている
- [ ] 新規テストで「HTML エンティティ化」「タグ join でリンク再構成不可」「正当出力の回帰」が検証されている
- [ ] 既存 markdown 出力系テストが全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: `sanitizeForObsidian('<img ...>')` の生 HTML 通過が 0 件、タグ join 再構成の再現テストが失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（Obsidian 実体は外部。単体＋境界テストで検証）

### 統合テスト
- `RecordingPipeline` → `formatMarkdownStep` 経由: 悪意ある要約/タグを持つ録画がノート本文生成時に無害化されること（steps 統合テストに 1 シナリオ追加）

### 単体テスト
- 新規: `src/utils/__tests__/markdownSanitizerBoundary.test.ts`
  - ビジネスロジック: HTML/リンク/wikiリンクのエスケープ結果。入力 `<img src=x onerror=alert(1)>` が `&lt;img ...&gt;` になること
  - 境界値: 空文字、記号のみ、`&amp;` 二重エンコード、unicode
  - 例外: 非文字列入力のガード
- 新規: `src/background/__tests__/markdownJoinSafety.test.ts`
  - タグ `foo [` と `bar](https://evil.example)` を含む録画で、生成 markdown にバランスしたリンクが形成されないこと（BDD シナリオの入力をそのまま使う）
  - `obsidianSyncService` / `gistSyncTarget` / `markdownFormatter` legacy の各タイトル埋め込みで `](url)` サフィックスがブレイクアウトしないこと

## 実装アプローチ
- **Outside-In**: まず境界テストを Red（現行は生 HTML 通過）にし、`sanitizeForObsidian` へのエンティティ化追加で Green。次に link-text ヘルパーの適用漏れ（legacy formatter / 2 sync-target / タグ）を解消
- **Red-Green-Refactor**: エンティティ化は既存エスケープの後段に追加し、出力差分を既存テストで固定

## 見積もり
1pt（要チームでの見積もり — エンティティ化＋適用漏れ 4 箇所＋回帰テスト。link-text ヘルパーは既存のため新設不要）

## 技術的考慮事項
- 依存関係: なし（Wave 1 推奨）
- テスタビリティ: BDD シナリオの入力（`<img src=x onerror=alert(1)>`、タグ `foo [` + `bar](https://evil.example)`）をそのまま回帰テストに使う
- 非機能要件: エンティティ化によるノート可読性の劣化を最小化（`<`/`>`/`&` のみ。markdown 記法文字は触れない）
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "sanitizeForObsidian|sanitizeForMarkdownLinkText" src/utils/markdownSanitizer.ts
rg -n "sanitize" src/background/pipeline/steps/formatMarkdownStep.ts
rg -n "sanitize" src/utils/markdownFormatter.ts
rg -n "sanitize" src/background/obsidianSyncService.ts src/background/syncTargets/gistSyncTarget.ts
rg -n "sanitize" src/dashboard/markdownExport.ts
```

### 実装手順
1. `sanitizeForObsidian` に HTML エンティティ化を追加（既存エスケープ後の最終段。`&` を先に処理して二重エンコード回避）
2. `markdownFormatter.formatEntryToMarkdown`（legacy）・`obsidianSyncService`・`syncTargets/gistSyncTarget` のタイトル埋め込みを `sanitizeForMarkdownLinkText` に統一
3. タグを `#tag` として summary 行に連結する箇所（`formatMarkdownStep` / `markdownFormatter`）でタグにも `sanitizeForMarkdownLinkText` を適用
4. テスト追加、`npm run validate`

### 落とし穴
- エンティティ化と `sanitizeForMarkdownLinkText` は役割が違う（前者は HTML 無効化、後者は markdown 構造文字の無効化）。両方必要
- Obsidian の wikilink `[[...]]` を壊さないこと（既存テストで固定）
- `src/dashboard/markdownExport.ts` は summary に `sanitizeForObsidian`、タイトル/URL に link-text/url ヘルパーを既に使用（VULN-020）— 本 PBI では summary のエンティティ化強化のみが効く
- `markdownFormatter.ts` には V1（`formatEntryToMarkdown`、旧・タイトルに `sanitizeForObsidian`）と V2（`sanitizeForMarkdownLinkText` 使用）が併存。V1 も対象

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-001/008/047 が解消されること
