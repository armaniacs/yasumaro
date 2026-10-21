# PBI: TLD 検証の multi-label 統一（UI 追加時もプリセットと同一形式を受け入れる）

## ユーザーストーリー

JP ドメインの TLD プリセットを使っているユーザーとして、プリセットと同じ '.go.jp' 形式を UI から追加できることがほしい、なぜなら検証時と追加時で形式が食い違うと、プリセット由来の値は有効なのに同じ形式の追加が拒否されるという非対称がユーザーから見えるから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（追加時のエラー文言と検証結果が変わる。検証側の multi-label は変更禁止 ― プリセット自体が '.go.jp, .ac.jp, .lg.jp' 形式のため single-label 化すると JP-Anchor が全滅する）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 11。なぜなぜ分析 /tmp/whywhy/outofscope-C.md（分析 3）2026-10-21

## 実装内容（owner 判断済み 2026-10-21）

1. 追加時の TLD 検証（domainValidation・ManagedCollections 経路）を multi-label に統一する（プリセットと同一形式 '.go.jp' を UI から追加可能に）
2. 検証時の multi-label（domainVerifier・checkJpAnchor 経路）は変更しない
3. 追加時のエラー文言を新しい形式契約に合わせて更新する（i18n 契約に従い en/ja 両方）

## 受け入れ基準（BDD）

```gherkin
Scenario: プリセットと同一形式を追加できる
  Given UI で TLD を追加する
  When '.go.jp' 形式を入力する
  Then 追加が成功する

Scenario: 検証時の挙動は変わらない
  Given checkJpAnchor が multi-label の TLD で検証する
  When '.go.jp' を検証する
  Then 従来どおり有効と判定される
```

## テスト戦略

- domainVerifier.test.ts / trustDb-validation.test.ts の既存 pin を fixture として先に確認する（trustDb-validation の describe は INCOMPLETE と自認しているため、統一時に完成させる）
- 追加経路の contract テストを新規追加する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 11・処理記録）
- src/utils/domainVerifier.ts・src/utils/domainValidation.ts（common 抽出は PBI 21 済み）

## 実装記録（2026-10-21）

- 追加時の TLD 検証（domainValidation isValidTld）を multi-label に統一（先頭ドットを剥がし各ラベルに RFC ラベル規則 1-63 文字・合計 2-253・空文字/'*'/'..'/末尾ドットを拒否。single-label '.com' / 'com' は従来どおり有効）
- 検証時経路（domainVerifier 本体）は変更なし
- エラー文言を新契約に更新: ManagedCollections 追加時文言（e.g., .com, .jp, .go.jp）、i18n jpAnchorInvalidFormat を en/ja 両方更新（旧「Must start with dot」は新契約と矛盾していたため）
- trustDb-validation.test.ts の INCOMPLETE 自認 describe を完成化（multi-label unified・'.ed.jp'/'ne.jp' 追加成功・プリセット duplicate 拒否・無効値拒否）。新規 contract テスト 17 件（isValidTld 契約 11 + 追加経路 5 + 追加/検証の対称性 1）
- 検証: 対象 24 ファイル 373 tests 全 green、type-check 通過、check-docs-chars 0 violations、eslint 通過、validate:fast green
