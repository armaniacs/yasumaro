# PBI: 出力契約の環境依存解消（ロケール明示・UTC 日付の localDate SSOT 統一・契約文書化）

## ユーザーストーリー

エクスポートやローカル Markdown を使っているユーザーとして、日付の出力がユーザーロケールとローカル日付で決まることがほしい、なぜなら環境依存の toLocaleString と UTC 日付は JST で「昨日」の名前のファイルや前日の範囲のエクスポートを生むから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴あり（出力契約が変わる: 深夜帯のファイル名・既定範囲・TSV の日付がローカル日付になる。heading の日付形式がユーザーロケールで決まる）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 15・16・17。なぜなぜ分析 /tmp/whywhy/outofscope-C.md（分析 10-12・現在地実測）2026-10-21

## 実装内容（owner 判断済み 2026-10-21）

1. （対象外 15）markdownTemplateUtils の getHostname と urlUtils の getHostname 並行定義に、契約が異なる意図（'' 契約 vs '[INVALID_URL]' 契約・出力先が日次 Markdown に露出する）をコメントで明文化する。統一は不採用
2. （対象外 16）markdownFormatter の heading 日付整形を getUserLocale() 明示に統一する（formatMarkdownStep と同一契約。timestampLocale オプションは定義済みで未使用）
3. （対象外 17）UTC 日付の残存 5 箇所を localDate SSOT に統一する。exportLogsPanel の exportToday（JST 朝にファイル名が「昨日」になる）・audit tsv・localMarkdownExport の既定範囲（深夜帯に前日の記録をエクスポートする）・reviewSummaryGenerator の Generated on・auditLogTsv の toIsoDate

## 受け入れ基準（BDD）

```gherkin
Scenario: ファイル名の日付がローカル日付になる
  Given JST 00:00-08:59 でエクスポートを実行する
  When ファイル名を生成する
  Then 当日のローカル日付が出る（「昨日」にならない）

Scenario: 期間既定が当日から始まる
  Given 期間指定を空でエクスポートを実行する
  When 既定範囲を解決する
  Then 当日のローカル日付から始まる

Scenario: heading の日付形式がユーザーロケールで決まる
  Given ユーザーロケールが en の環境で Markdown を生成する
  When heading を整形する
  Then ユーザーロケールの形式で出る
```

## テスト戦略

- markdownJoinSafety.test.ts の鏡像式 pin（テスト自身が toLocaleString で本番を模倣）を固定形式 pin に置き換える
- localDate.ts の既存テストパターン（固定タイムゾーン fixture）に合わせる

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 15・16・17・処理記録）
- src/utils/localDate.ts（SSOT。PBI 2026-09-28-11 で導入）
