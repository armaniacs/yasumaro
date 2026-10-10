# PBI: `sanitizeTitle` の行区切り正規化を Unicode 行終端まで広げ、非文字列 title の例外化を塞ぐ

- 種別: fix
- RICE: 7.2（R3 × I1.5 × C0.8 / E0.5。I は「注入対策が半分」＝`\r`/`\n` は閉じたが U+2028 系が残るため 1.5、C は実レンダラの行分割挙動が未検証のため 0.8）
- 依存: なし（他 PBI とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）Blue Team Leader Medium

## ユーザーストーリー

ユーザーとして、悪意あるページタイトルを踏んでも日次ノートの Markdown 構造が壊れてほしくない。なぜなら現状の `sanitizeTitle` は `\r\n` しか正規化せず、U+2028 / U+2029 / U+0085 を残すため「タイトルは単一行」という PBI-15 の契約が半分しか守られていないから。

## 背景（現状・証拠）

- `src/utils/markdownFormatter.ts:62-67` — 正規化は `:66` の `raw.replace(/[\r\n]+/g, ' ')` のみ。
- 出力先は `src/utils/markdownFormatter.ts:160`（`# ${title}` の見出し行）と `:173`（`- [title](url)` の行）。
- `title` は `sender.tab.title`（ページの `<title>` = 完全に外部入力）から `src/background/handlers/recordingHandlers.ts:142` 経由で入る。`sanitizeForMarkdownLinkText` は `[ ] ( )` しかエスケープしない（`src/utils/markdownSanitizer.ts:151-159`）。
- したがって U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR / U+0085 NEL はそのまま残る。U+2028/U+2029 は Unicode・JSON・JS の定義上の行終端であり、CodeMirror 系エディタ（Obsidian）はこれらでも行を分割する。ページ題名に `\u2028    - [forged](https://evil)` を仕込めば、日次ノートに偽の行を追加できる余地が残る。
- 加えて同関数は `raw.replace(...)` を**非文字列ガードより前**に呼ぶ。旧実装は `sanitizeForMarkdownLinkText` へ委譲しており同関数は非文字列をそのまま返す（`markdownSanitizer.ts:152-154`）ため例外にならなかった。`opts.titleFallback === false` の呼び出し元（`src/background/pipeline/steps/formatMarkdownStep.ts:57`）で実行時に `title` が `undefined` になると `TypeError` で Markdown 生成（＝記録）が中断する。
- 本ブランチの `sanitizeTitle` には連続空白圧縮 `replace(/  +/g, ' ')` も入り、多重空白タイトルの表現が変わる（後方互換の破壊ではないが仕様変更の明示が望ましい）。
- `sanitizeSummary` は `/\n+/` を使っており、行区切り正規化の正典が関数ごとにばらついている。

## BDD 受け入れシナリオ

```gherkin
Scenario: U+2028 を含むタイトルが単一行に正規化される
  Given タイトルが "safe\u2028    - [forged](https://evil)" である
  When sanitizeTitle を実行する
  Then 出力に行区切り文字が含まれず、1 行に収まる

Scenario: U+2029 / U+0085 / CR / LF も同様に正規化される
  Given タイトルが "a\u2029b\u0085c\rd\ne" である
  When sanitizeTitle を実行する
  Then 出力が "a b c d e" になる

Scenario: 非文字列 title でも例外にならない
  Given title が undefined で titleFallback が false である
  When sanitizeTitle を実行する
  Then TypeError を投げず、空文字または規定のフォールバックを返す
```

## 受け入れ基準

- [x] 正規化対象を行終端の全集合（`\r` `\n` `\u2028` `\u2029` `\u0085`）に広げる
- [x] 行区切りに限らず、Markdown 行頭の意味を持つ制御文字をホワイトリスト方式（タブ・スペース以外の C0/C1 を空白化）で扱うか、少なくとも上記 5 文字を対象にする。どちらを採るか選定理由を PBI に記録する
- [x] `sanitizeSummary` の `/\n+/` と共通の `normalizeSingleLine()` を切り出して 1 箇所に寄せる（同じ契約を 2 実装で持たない）
- [x] `raw.replace()` より前に必ず文字列化する（非文字列は空文字またはフォールバックへ落とす）。`sanitizeForMarkdownLinkText` の非文字列許容に依存しない
- [x] `titleFallback: false` 経路（`formatMarkdownStep.ts:57`）で `title` が `undefined` でも例外にならないことをテストで固定する
- [x] 連続空白圧縮の仕様変更を CHANGELOG（および必要な場合は docs）に明示する
- [x] 既存の CR / LF テスト（`1bc43c2d` / `c7bd180c` で追加）が green のまま
- [x] `npm run validate` が green

## テスト戦略

- unit: `src/utils/__tests__/markdownFormatter.test.ts` に `\u2028` / `\u2029` / `\u0085` の各ケース、混在ケース、非文字列（`undefined` / `null` / 数値）ケースを追加
- unit: `titleFallback: false` で `undefined` を渡しても throw しないことを検証（Red → Green）
- 回帰: 既存の見出し・リンク生成テスト（単一行契約の pin）が green
- 統合: `formatMarkdownStep` を通した Markdown 生成が、悪意あるタイトルで複数行にならないこと

## 見積もり

0.5 SP

## 技術的考慮事項

- CommonMark / Obsidian の行終端は `\n` `\r\n` `\r` のみで、U+2028/U+2029 は行終端として解釈されないという反論がある（Red Team はこの理由で指摘から除外した）。しかし Obsidian のエディタは CodeMirror 系で U+2028 を改行として扱い、JSON 保存を経てもそのまま残るため、「タイトルは単一行」という契約を文字種で保証する価値がある。**実レンダラでの挙動確認は手動確認項目とする**
- 空白圧縮（`/  +/g`）は本ブランチで意図的に入った変更。挙動は維持し、CHANGELOG で明示するに留める（削除はしない）

## 実装者向け注記

### 実装手順

1. `\u2028` ケースと非文字列ケースの失敗テストを先に書く（Red）
2. `normalizeSingleLine()` を切り出し、`sanitizeTitle` / `sanitizeSummary` の両方から使う
3. 非文字列ガードを正規化の前段に置く
4. CHANGELOG に空白圧縮の仕様変更を追記
5. `npm run validate`

### 落とし穴

- `replace` の順序（文字列化 → 制御文字 → 空白圧縮）を入れ替えると、非文字列で例外が再発する
- `sanitizeSummary` の既存期待値（`\n` の扱い）を変えないこと。共通化で挙動を変える場合はテストを更新し、理由を記録する
- 実時間待ちをテストに入れない

## Definition of Done

- [x] U+2028 / U+2029 / U+0085 の正規化テストが green
- [x] 非文字列 title で例外にならないテストが green
- [x] `npm run validate` が green
- [x] 実レンダラ（Obsidian）での行分割確認が手動確認項目として残っている旨を明記
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 / commit `df91afb2`）

| コマンド | 結果 |
|---|---|
| `npx vitest run src/utils/__tests__/markdownFormatter.test.ts` | 26 passed（新規 4 件を含む） |
| 関連 7 ファイル（formatMarkdownStep / markdownJoinSafety / recordOrchestrator / copyMarkdownButton ほか） | 108 passed |
| `npm run validate` | exit 0（1055 files / 15933 tests passed） |

**ユーザー作業（自動化されない手動確認）**: 実レンダラ（Obsidian）が U+2028 / U+2029 を
行区切りとして扱うかの目視確認は未実施。コード上の契約（`sanitizeTitle` の出力は単一行）は
テストで固定済みで、実害の有無はこの手動確認で確定する。

