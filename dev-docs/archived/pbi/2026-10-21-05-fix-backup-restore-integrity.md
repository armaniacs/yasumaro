# PBI: バックアップ選択の数値比較と復元 allowlist の SSOT 整合

## ユーザーストーリー

設定バックアップからの復旧に頼っているユーザーとして、バックアップの「最新 1 件選択」が桁数混在でも古い方を選ばず、復元 allowlist に消えたキーの行が残らないことがほしい、なぜなら辞書順比較は将来の桁数変更で stale なバックアップを復元し、Trust DB 一本化で消えたキーの行は SSOT 整合を壊したまま将来の drift を黙って通すから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴なし（数値 comparator は本番挙動を完全に不変にする。2 行削除は inert な混入の除去）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 7・8。なぜなぜ分析 /tmp/whywhy/outofscope-B.md（分析 3-5）2026-10-21

## 実装内容（owner 判断済み 2026-10-21）

1. （対象外 7）selectLatestSettingsBackupKey を数値 comparator に修正する。suffix は 13 桁の epoch ms で同桁数のため本番挙動は不変。mixed-length（テスト注入・将来の精度変更）でも古いバックアップを復元しなくなる
2. （対象外 8）restorableSettings の 'safety_mode' / 'tranco_tier' 2 行を削除する（Trust DB 一本化コミット `b9ee19cc` の配線漏れ。2 キーは StorageKeys 外・reader 0 件・実データの正は trust_db）。あわせて「allowlist ⊆ StorageKeys」の不変テストを追加し、将来の drift を構造的に検出する

## 受け入れ基準（BDD）

```gherkin
Scenario: 桁数混在でも最新のバックアップが選ばれる
  Given suffix の桁数が混在するバックアップが存在する
  When 最新のバックアップを選択する
  Then 数値として最新の 1 件が選ばれる

Scenario: 復元 allowlist は StorageKeys の部分集合である
  Given restorableSettings の allowlist が存在する
  When 不変テストを実行する
  Then すべての行が StorageKeys のメンバーである
```

## テスト戦略

- selectLatestSettingsBackupKey に直 pin の純粋関数テストを新規追加する（mixed-length fixture 込み）
- 間接 pin 3 ファイル（mixed-length fixture は辞書順==数値順が一致する組なので修正でも壊れない）を fixture として先に確認する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 7・8・処理記録）
- src/utils/storage/restorableSettings.ts（allowlist）

## 実装記録（2026-10-21）

- selectLatestSettingsBackupKey を数値 comparator に修正（backupKeyGeneration を導入・epoch ms を /^\d+$/ でパースして数値比較。非数 suffix は最も古い扱い、同世代同値は辞書順 tie-break で入力順非依存。本番 13 桁同桁数では選択結果は完全に不変）
- restorableSettings の 'safety_mode' / 'tranco_tier' 2 行を削除（削除箇所に Trust DB 一本化 b9ee19cc の配線漏れである旨を記録）
- テスト: settingsBackupSelectLatest.test.ts 新規 10 件（mixed-length・13 桁 epoch ms・入力順非依存・bare key・非数 suffix ほか）、restorableSettings-spec-table.test.ts に「allowlist ⊆ StorageKeys」不変テスト追加（違反キー一覧を failure に出す）
- pin 更新 1 件（fixture-first で発見・owner 承認済み）: settingsBackupRestoreParity.test.ts:85-96 が mixed-length の辞書順≠数値順の組を現行挙動＝数値的に古い方で pin しており、PBI の BDD 契約更新としてテスト名と期待値を修正後の挙動（'ten'）に明示更新
- 検証: 対象 10 ファイル 150 tests 全 green、storage/__tests__ 全 65 ファイル 558 tests 全 green、type-check 通過、eslint 通過、validate:fast green
