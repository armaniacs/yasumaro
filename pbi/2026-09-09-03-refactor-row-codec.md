# PBI 03: 行シェイプ codec — rowMapper 4 コピーの統合と列集合 drift の解消

## ユーザーストーリー

SQLite バックエンド（OPFS worker / IndexedDB / fallback）を保守する開発者として、1 行の読み出し方法（列集合とマッピング）が 1 箇所で定義されていてほしい。なぜなら現状は IDB が positional（33 列 + 11 列 ×2）、OPFS worker が named（13 列 / 11 列）の私的 mapper を 4 コピー持ち、`buildPlainListStatements` の列省略時既定 `'*'` により**同じ builder から別の列集合**が返り、schema 列順の変更が positional reader をサイレントに壊すから。

## 優先度

- 順位: 03 / 6
- RICE スコア: 12.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.4 人週）
- 根拠: PBI-34（queryPlan SSOT）が SQL テキストのみを対象にし行形を残した、半分済みの深掘り。実 drift（plain-list で IDB 33 列 vs OPFS 13 列）が確認済みのため Confidence 高。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし（01/02 とファイル非重複。並行バッチ可）。

## BDD 受け入れシナリオ

```gherkin
Scenario: plain-list の列集合がバックエンド間で一致する
  Given buildPlainListStatements が columns を必須引数にした
  When  IdbVfsBackend と opfsWorker crudHandlers が同じ BROWSING_LOG_COLUMNS を渡す
  Then  両バックエンドの plain-list 応答が同一列集合になる
        （現行の 33 vs 13 の無文書分歧は spec か bug かが実装メモに決着記録され、
        決着に沿った列集合になる）

Scenario: schema の列順変更で positional reader が壊れない
  Given rowCodec が named マッピングを所有する
  When  browsing_logs の列を 1 列挿入する（テスト内で列順を入れ替える）
  Then  全バックエンドの query / search 結果のマッピングが正しいまま保たれる

Scenario: FTS と LIKE の rank 差分だけが分岐になる
  Given IdbVfsBackend の FTS 11 列マップと LIKE 11 列マップ（rank: 0）が統合される
  When  両検索パスを実行する
  Then  rank の供給源だけが差分となり、他の 10 列のマッピングは 1 箇所に集約される
```

## 受け入れ基準

- [ ] `rowCodec` モジュール新設: `{ columns, mapNamed(row), mapPositional(row, columns) }` を所有し、`BROWSING_LOG_COLUMNS` 定数を 1 箇所に定義
- [ ] `buildPlainListStatements` の `columns` を必須化（`'*'` 既定値削除）。呼び出し側（IdbVfsBackend / crudHandlers）が同じ定数を渡す
- [ ] `IdbVfsBackend.ts` の FTS（:92-104）/ LIKE（:128-141）/ plain（:435-471 `rowToEntry`）3 mapper を codec 経由に統合（`rank` 注入点のみ分岐）
- [ ] `searchHandlers.ts:36-50` / `crudHandlers.ts:47-61` の named mapper を codec 経由に統合
- [ ] 33 vs 13 列分歧の決着（spec として残すか named 13 に統一するか）を実装メモに記録し、決着に沿って実装
- [ ] `insertBatch` の `inserted/skipped` 集計差分（IdbVfsBackend 行毎 changes() vs crudHandlers 最終 1 回）を parametric テストで先に確定し、bug なら修正（bug なら本 PBI スコープで対応・CHANGELOG 記載）
- [ ] `queryPlan.ts:267` の `AS c` / `AS rank` エイリアスコメントが codec の保証（テスト）になる

## テスト戦略

- parametric: query / search を IDB・OPFS worker・InMemory の各 backend で同一 fixture で実行し、列集合と値の一致を検証（既存 InMemoryTransport テスト基盤を利用）
- 単体: rowCodec の mapNamed / mapPositional 真理値表（NULL / 型付き値 / 列順入れ替え）
- 回帰: 既存 queryPlan / バックエンド系テスト green

## 実装アプローチ

1. insertBatch 集計の parametric テストを先に書き、実挙動を確定（bug ならこの時点で分離判断）
2. rowCodec 新設（列定数 + named/positional mapper）
3. buildPlainListStatements columns 必須化 + 呼び出し側修正
4. IdbVfsBackend 3 mapper 統合 → worker 側 2 mapper 統合
5. 列分歧の決着記録

## 見積もり

0.4 人週。難易度: 🟡中。副作用: 🟡軽微（列分歧の決着次第で応答列集合が変わり得る → dashboard の消費フィールド確認が必要）。種別: 🔧非機能追加（refactor）。

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] type-check / lint / 対象テスト green
- [ ] insertBatch 集計の確定記録（bug だった場合は修正 + CHANGELOG）
- [ ] コードレビュー完了
- [ ] `00-INDEX.md` 更新
