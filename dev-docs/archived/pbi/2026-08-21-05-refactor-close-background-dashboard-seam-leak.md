# PBI: background → dashboard seam leak の解消 — markdown formatting の utils 集約

## ユーザーストーリー
開発者として、background の `dashboardSqlite/deps.ts` が `dashboard/obsidianFormatter.ts` に依存する seam leak を解消し、共通の `utils/markdownFormatter.ts` seam に集約したい、なぜなら background と dashboard は別コンテキストであり、background が dashboard に依存すると dashboard 変更が background を壊し、seam の方向が逆転するから

## 優先度
- 順位: 5 / 5
- RICEスコア: 12.5（Reach=50 / Impact=0.5 / Confidence=50% / Effort=1人週）
- 根拠: 影響範囲は `deps.ts` の1ファイルと `obsidianFormatter.ts` の呼び出し元のみ。Impact 0.5（振る舞い変化なし、seam 方向の是正）。Confidence 50%（`obsidianFormatter.ts` が dashboard 固有か共有可能かの判断に不確実性）。Effort 1週（formatter の移動 or re-export、両 side の import 置換、テスト）。他PBIと独立だが、PBI 03（SqliteClient 深掘り）が `deps.ts` を触るため、PBI 03 完了後に着手すると競合を避けられる。

## ビジネス価値
- background と dashboard が互いに依存せず、utils という共有の深い module に向かって依存する（依存の方向が一方向に揃う）
- markdown formatting のバグ（sanitization 抜けなど）が1 module に局在し、background と dashboard の両方で同時に修正される（locality）
- 測定: `grep -rn "from.*dashboard/" src/background/ --include="*.ts" | grep -v dashboardSqliteProtocol` が0件になること

## BDD受け入れシナリオ

```gherkin
Scenario: background と dashboard が共有 seam 越しに formatting する
  Given utils/markdownFormatter.ts が formatEntriesToMarkdown を公開する deep module である
  When background の deps.ts と dashboard の任意の panel が formatEntriesToMarkdown を呼ぶ
  Then 両方とも from '../../utils/markdownFormatter.js'（または共有 seam）から import し、from '../../../dashboard/' ではない

Scenario: seam leak が存在しない
  Given src/background/ 配下を grep する
  When "from.*dashboard/obsidianFormatter" を検索する
  Then ヒットが0件である

Scenario: 境界 — dashboard 固有の formatting が utils に漏れない
  Given dashboard 固有の UI 整形（例: panel の HTML 構築）が存在する
  When background が utils/markdownFormatter を import する
  Then dashboard 固有の UI ロジックは utils に含まれず、共有の markdown 生成のみが utils にある

Scenario: エラー — formatting 失敗時の挙動が一貫する
  Given formatEntriesToMarkdown が空配列や不正な entry で null を返す
  When background の append_to_obsidian と dashboard の preview がそれぞれ呼ぶ
  Then 両方とも同じ null ハンドリング（"No matching entries" などの一貫したエラー）で応答する
```

## 受け入れ基準
- [x] `src/background/handlers/dashboardSqlite/deps.ts:2` の `from '../../../dashboard/obsidianFormatter.js'` import が `from '../../../utils/markdownFormatter.js'`（または `from '../../../utils/markdownFormatter.js'` 経由の re-export）に置換されている
- [x] `src/dashboard/obsidianFormatter.ts` が `src/utils/markdownFormatter.ts`（または既存の `src/utils/markdownFormatter.ts`）に委譲する薄い re-export になっているか、共有ロジックが utils に移動している
- [x] `grep -rn "from.*dashboard/" src/background/ --include="*.ts" | grep -v "dashboardSqliteProtocol" | grep -v "__tests__"` が0件（background → dashboard の import が存在しない）
- [x] `grep -rn "from.*dashboard/" src/utils/ --include="*.ts"` が0件（utils → dashboard の逆依存も存在しない）
- [x] 既存の `deps.test.ts` / `obsidianFormatter.test.ts` 相当のテストが新 seam 越しにパスする
- [x] `npm run type-check` と `npm run validate` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで「Obsidian に追記」→ background の append_to_obsidian が markdown を生成し、Obsidian daily note に追記されるシナリオ（新 seam 越し）

### 統合テスト
- `createSqliteClientDeps` が `formatEntriesToMarkdown` を新 utils seam 経由で解決し、background と dashboard の両方が同じ出力を得る契約テスト
- `obsidianFormatter` の re-export が utils の出力をそのまま返す委譲テスト

### 単体テスト
- `utils/markdownFormatter.test.ts` で空配列 / 単一行 / 複数行 / sanitization あり/なし の境界値テスト
- `deps.ts` の `formatEntriesToMarkdown` が null を返した際の deps のハンドリング（append_to_obsidian が "No matching entries" を返すこと）

## 実装アプローチ
- **Outside-In**: まず `src/utils/markdownFormatter.ts`（既存）の公開 interface を確認し、background と dashboard の両方が同じ出力を得るテストを RED で書く → `deps.ts` の import を utils に置換して GREEN → `dashboard/obsidianFormatter.ts` を utils への re-export に縮小して Refactor
- **Red-Green-Refactor**: 既存の `src/utils/markdownFormatter.ts` が既に存在する場合は移動ではなく re-export で済むため、差分は小さい。`obsidianFormatter.ts` が独自ロジックを持つ場合は utils に統合

## 見積もり
1pt（要チームでの見積もり）— import 置換と re-export 整理のみ、振る舞い変化なし
- **確認**: src/background/handlers/dashboardSqlite/deps.ts:2 に seam leak が実在
  - `import { formatEntriesToMarkdown } from '../../../dashboard/obsidianFormatter.js'`

## 技術的考慮事項
- 依存関係: PBI 03（SqliteClient 深掘り）が `deps.ts` を触るため、PBI 03 完了後に着手すると競合を避けられる。必須依存ではないが推奨順序
- テスタビリティ: `formatEntriesToMarkdown` は純粋関数（entries → markdown string | null）のため、InMemory adapter 不要で直接テスト可能。seam は import パスのみ
- 非機能要件: `markdownSanitizer.ts` の sanitization は utils 内で完結するため、background と dashboard の両方で同じ sanitization が適用される

## 実装者向け注記

### 現状コードの確認
```bash
# seam leak の実態
grep -rn "from.*dashboard/" src/background/ --include="*.ts" | grep -v "__tests__" | grep -v ".test.ts"
# 共有 formatter の実態
grep -n "formatEntriesToMarkdown" src/dashboard/obsidianFormatter.ts src/utils/markdownFormatter.ts
# どちらが深い実装を持つか
wc -l src/dashboard/obsidianFormatter.ts src/utils/markdownFormatter.ts
# deps が formatter をどう使うか
grep -n "formatEntriesToMarkdown" src/background/handlers/dashboardSqlite/deps.ts -A 2 -B 2
```
`src/utils/markdownFormatter.ts` が既に存在する場合は、dashboard 側が utils に委譲しているか、独自実装を重複させているかを確認。重複なら utils に集約、委譲なら deps の import 先を dashboard から utils に変えるだけで済む。

### 実装手順
1. `src/utils/markdownFormatter.ts` と `src/dashboard/obsidianFormatter.ts` の実装を比較（`diff`）。共有可能な markdown 生成ロジックを特定
2. 共有ロジックが `src/utils/markdownFormatter.ts` に存在することを確認（なければ `dashboard/obsidianFormatter.ts` から移動）
3. `src/background/handlers/dashboardSqlite/deps.ts:2` の import を `from '../../../utils/markdownFormatter.js'` に置換
4. `src/dashboard/obsidianFormatter.ts` を `export { formatEntriesToMarkdown } from '../utils/markdownFormatter.js'` の re-export に縮小（または削除し、dashboard 側も直接 utils を import）
5. `grep -rn "from.*dashboard/" src/background/ --include="*.ts"` が0件であることを確認
6. `npm run type-check` と `npm run validate` で確認

### 落とし穴
- `src/dashboard/obsidianFormatter.ts` が dashboard 固有の定数（例: `STORAGE_KEYS` や panel 固有のフォーマット）を import している場合、utils に移動すると dashboard への依存が utils に漏れる。共有の markdown 生成ロジックのみを utils に残し、dashboard 固有の装飾は dashboard 側に残すこと
- `PBI 03` が `deps.ts` を同時に変更すると import 行が競合する。PBI 03 完了後に着手するか、変更前に `git rebase` で競合を解消すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（markdownFormatter の境界値）
- [x] コードレビュー完了
- [x] リファクタリング完了（background → dashboard import 削除、共有 seam 確立）
- [x] ドキュメント更新済み（LAYERS.md の依存ルールに違反が解消された旨を追記）
