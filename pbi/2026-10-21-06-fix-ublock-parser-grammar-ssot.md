# PBI: ublockParser の negatedDomains 文法統合と transform ID 削除

## ユーザーストーリー

ublock フィルタをインポートしているユーザーとして、`domain=~example.com` と `~domain=example.com` の 2 構文が同じ意味で解釈され、変換パイプラインに読めない ID が混入しないことがほしい、なぜなら 2 分枝文法は同じ negatedDomains にマップする二重管理で、write-only の ID は保守コストだけを生むから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴なし（両構文とも同一マップのため統合は既存フィルタの解釈を不変にする。片方削除だと `~domain=` フィルタが無条件ブロックに変わるため、統合は「等価統合」のみ）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 10。なぜなぜ分析 /tmp/whywhy/outofscope-C.md（分析 1-2・現在地実測）2026-10-21

## 実装内容

1. （対象外 10a）options.ts の `domain=~` 分枝と `~domain=` 分枝を 1 実装に統合する（消費者は ublockMatcher の 1 箇所のみ。等価統合で既存フィルタの解釈は不変）。あわせて ublockMatcher の「block when」誤解を招くコメントを訂正する
2. （対象外 10b）transform の ID（32bit ハッシュを UUID 風に偽装）を削除する。owner 判断: id は write-only（ストレージ型・rulesBuilder・matcher 変換の全経路で捨てられる）のため形式変更ではなく削除を選択

## 受け入れ基準（BDD）

```gherkin
Scenario: 2 構文が同じ意味で解釈される
  Given 'domain=~example.com' と '~domain=example.com' のフィルタがある
  When パースする
  Then 両方とも同じ negatedDomains になる

Scenario: 変換パイプラインに読めない ID が混入しない
  Given ublock ルールを変換する
  Then 中間形式に ID フィールドは存在しない
```

## テスト戦略

- ublockParser.test.ts に `~domain=` 分枝の parser pin を追加する（現状 `domain=~` のみ pin）
- ublockParser-transform.test.ts の ID pin は削除に合わせて更新する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 10・処理記録）
- src/utils/ublockParser/options.ts・src/utils/ublockMatcher.ts
