# PBI: メッセージバリデータの fail-closed 統一（未登録 validator・silent フォールバック・検証欠落の解消）

## ユーザーストーリー

拡張の内部メッセージ契約を保守している開発者として、型に載っているメッセージ型がすべてバリデータで検証され、無効 payload が黙って成功扱いにならないことがほしい、なぜなら dispatch が validator 未登録を fail-open でスキップする構造では、wire の契約違反がテストでも本番でも観測できず、silent フォールバックが意味論を覆うから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（wire 挙動の厳格化。TEST_AI の sender 側期待値と uniformity pin の 2 件の書き換えが不可避）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 2。なぜなぜ分析 /tmp/whywhy/outofscope-A.md（分析 3-6・現在地実測）2026-10-21

## 実装内容

1. （対象外 2a）GENERATE_REVIEW_SUMMARY の validator を追加し、'monthly' 以外を weekly に silent フォールバックする分岐を撤去する（無効値は拒否）
2. （対象外 2b）TEST_AI の 3 者食い違いを解消する。sender（connectionTests）の payload:{} 送出を削除し、envelopePolicy の NO_PAYLOAD 例外を削除して fail-closed に統一する
3. （対象外 2c）MANUAL / PREVIEW / SAVE_RECORD の byte-stat 検証を追加する（BYTE_STAT_FIELDS ループ流用。型は ByteStatsPayload 結合で到達可能なのに動作未定義）
4. （対象外 2d）LOG_FORWARD の validator を追加し、未知 level を 'info' に降格させず拒否する

## 受け入れ基準（BDD）

```gherkin
Scenario: 未登録だったメッセージ型が検証される
  Given GENERATE_REVIEW_SUMMARY / LOG_FORWARD の validator が未登録である
  When 無効 payload を送る
  Then メッセージは拒否される
    And 有効 payload は従来どおり処理される

Scenario: TEST_AI が fail-closed に統一される
  Given sender が payload:{} を送っていた
  When envelopePolicy の NO_PAYLOAD 例外が削除される
  Then sender は payload を送らず gate は例外なしで通す
    And 既存の uniformity pin は新しい構成に更新される

Scenario: manual 系メッセージの byte-stat が検証される
  Given MANUAL / PREVIEW / SAVE_RECORD の payload が ByteStatsPayload 結合に到達する
  When byte-stat フィールドが不正である
  Then メッセージは拒否される
```

## テスト戦略

- 先に既存 pin（uniformity.test.ts / connectionTests.test.ts / dashboardSenderGuard.test.ts）を読み、書き換える対象を明示する
- 追加 validator は既存 validators.ts のパターン（BYTE_STAT_FIELDS ループ）に合わせる

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 2・処理記録）
- dev-docs/archived/pbi/2026-10-20-24-refactor-srp-splits.md（messageTypes の ByteStatsPayload 結合）

## 実装記録（2026-10-21）

- 2a: GenerateReviewSummaryValidator を validators.ts に追加（periodType 必須 + weekly/monthly 列挙）。systemHandlers の monthly→weekly silent フォールバック（三項演算子）を撤去し、契約外 periodType は拒否
- 2b: connectionTests の payload:{} 送出を削除（bare envelope 契約）。envelopePolicy の NO_PAYLOAD legacy 例外を削除し shape gate を唯一の受理権威に
- 2c: ManualRecordValidator に ByteStatsPayload 検証を追加（BYTE_STAT_FIELDS ループ × MAX_BYTE_STAT_BYTES、aiSummaryCleansedElements、assertCleansedReasons ほか。MANUAL / PREVIEW / SAVE_RECORD の 3 型に 1 か所で適用、ValidVisit と同一の reject ポリシー）
- 2d: LogForwardValidator を追加（level info/warn/error 列挙）。handler の else 分岐は 'info' 専用に狭窄
- 逸脱（報告済み・理由付き）: MessageRouter に setValidator 2 行（登録サイトがここしかないため）、ACTIVITY_UPDATE sender 2 箇所（recordSession・encryptionSession）の payload:{} 削除（例外削除の直の波及・機能後退防止。なぜなぜ分析が取りこぼしていた分）
- pin 書き換え: connectionTests.test.ts（sender pin → bare envelope）、systemHandlers.test.ts:402（silent フォールバック pin → periodType 明示化 + 拒否テスト 2 件）、envelopePolicy.test.ts（migration-skip + shape matrix）、systemHandlers.test.ts:485（降格 pin の改名・期待値不変）。統合側: envelopeShape.ts の stale コメント訂正
- 検証: 対象 7 スイート 315 tests 全 green、フルスイート 1115 ファイル / 16603 tests 全 green、type-check 通過、eslint 通過、validate:fast green
