# PBI: Markdown/Obsidian 出力サニタイズ境界の確立（VULN-001/008/047, CWE-79）

## ユーザーストーリー
利用者として、訪問したページの内容が Obsidian 日次ノートやローカル markdown エクスポートに安全に書かれるようにしたい、なぜならページ由来の生 HTML（`<img onerror>` 等）や AI タグの断片が「サニタイズ済み」を名乗る境界を素通りし、ノート内で実行・偽装リンクになるから

## ビジネス価値
- Medium 脆弱性（VULN-001）の解消: `sanitizeForObsidian` が HTML を通すことが実証済み（payload が verbatim でノートに到達）
- VULN-008/047 の解消: per-field サニタイズが join 境界で `[ #bar](https://evil.com)` に再構成される（実証済み）
- 測定方法: `sanitizeForObsidian('<img src=x onerror=alert(1)>')` が HTML をエンティティ化すること、4 消費者の join 出力に生リンク構文が形成されないこと

## 優先度
- 順位: 2 / 14
- RICEスコア: 2375（Reach=1000 / Impact=0.5 / Confidence=95% / Effort=0.2人月）
  - Reach 1000: ページ→ノート経路は全 Obsidian 連携ユーザーに到達（録画は既定動作）
  - Impact 0.5: Medium。ノート内 HTML 実行は Obsidian レンダラ次第だが、偽装リンク・構造汚染は確実
  - Confidence 95%: 16 呼び出しサイトが単一 choke point を経由（スイープ確認済み）。修正は境界関数 1 箇所＋ヘルパー 1 本
  - Effort 0.2: 境界強化＋4 消費者のヘルパー適用＋テスト
- 根拠: スイープで「1 choke point 修正で 15 サイトが恩恵」が確認済み。境界を正すことが全消費者の根cause解消になる

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
- [ ] `src/utils/markdownSanitizer.ts:110-122` の `sanitizeForObsidian` が、既存のリンク/wikiリンク エスケープに加え `<`/`>`/`&`（属性文脈の `"` を含む）をエンティティ化する
- [ ] 結合安全なフラグメントエスケープヘルパー（`[ ] ( )` を無効化する link-text エスケープ）が新設され、`formatMarkdownStep.ts:53-56`、`markdownExport.ts:78-83`、`saveLocalMarkdownStep.ts:80-85`、`markdownFormatter.ts:8-10` の 4 消費者で適用されている
- [ ] ヘルパーは死蔵 sync-target（`obsidianSyncService.ts:62`、`gistSyncTarget.ts:49`）にも事前適用されている（将来配線時の再発防止）
- [ ] 新規テストで「HTML エンティティ化」「join 再構成の不可能性」「正当出力の回帰」が検証されている
- [ ] 既存 markdown 出力系テストが全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: `sanitizeForObsidian('<img ...>')` の生 HTML 通過が 0 件、join 再構成 PoC が失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（Obsidian 実体は外部。単体＋境界テストで検証し、ノート内容は PoC で確認）

### 統合テスト
- `RecordingPipeline` → `formatMarkdownStep` 経由: 悪意ある要約/タグを持つ録画がノート本文生成時に無害化されること（steps 統合テストに 1 シナリオ追加）

### 単体テスト
- 新規: `src/utils/__tests__/markdownSanitizerBoundary.test.ts`
  - ビジネスロジック: HTML/リンク/wikiリンクのエスケープ結果
  - 境界値: 空文字、記号のみ、`&amp;` 二重エンコード、unicode
  - 例外: 非文字列入力のガード
- 新規: `src/background/__tests__/markdownJoinSafety.test.ts`（4 消費者×join 再構成 PoC の否定）

## 実装アプローチ
- **Outside-In**: まず境界テストを Red（現行は生 HTML 通過）にし、`sanitizeForObsidian` 強化で Green。次に 4 消費者の join をヘルパーに置換して Green
- **Red-Green-Refactor**: エンティティ化は既存エスケープの後段に追加し、出力差分を既存テストで固定

## 見積もり
2pt（要チームでの見積もり — 境界強化＋ヘルパー新設＋4 消費者適用＋テスト 2 ファイル）

## 技術的考慮事項
- 依存関係: なし（Wave 1 推奨）
- テスタビリティ: PoC `poc/VULN-001_html_injection_obsidian_notes.md` / `VULN-008_tag_summary_join_link_reformation.md` の入力をそのまま回帰テストに転用
- 非機能要件: エンティティ化によるノート可読性の劣化を最小化（`<`/`>`/`&` のみ。markdown 記法文字は触れない）
- 注意: 4 消費者は同一パターンの複製 — 1 ヘルパーに集約し、重複を増やさない

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '105,125p' src/utils/markdownSanitizer.ts
sed -n '48,60p' src/background/pipeline/steps/formatMarkdownStep.ts
sed -n '5,20p' src/utils/markdownFormatter.ts
sed -n '75,88p' src/background/markdownExport.ts
```

### 実装手順
1. `sanitizeForObsidian` に HTML エンティティ化を追加（既存エスケープ後の最終段）
2. `sanitizeLinkTextFragment`（仮称）ヘルパーを `markdownSanitizer.ts` に新設（`[ ] ( )` エスケープ）
3. 4 消費者の tag/summary 断片にヘルパーを適用
4. 死蔵 sync-target 2 箇所にヘルパーを事前適用（コメントで将来配線時の契約を明記）
5. テスト追加、`npm run validate`

### 落とし穴
- エンティティ化を join の前にかけると再構成は防げるが `[` が残る — フラグメントエスケープは「構造文字の無効化」であり、エンティティ化とは役割が違う。両方やること
- Obsidian の wikilink `[[...]]` を壊さないこと（既存テストで固定）
- `markdownExport.ts` は summary に別サニタイザを使う（VULN-030 とは別経路）— 本 PBI では summary 経路に触れない

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-001/008/047 が解消されること
