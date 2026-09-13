# PBI: deriveMigrationStatusのopfsDone矛盾入力にテストを追加

## ユーザーストーリー
拡張機能の開発者として、`deriveMigrationStatus`が`opfsDone=true`かつ`opfsLegacyDbPath`が非null（移行済みなのにレガシーDBがまだ存在する矛盾状態）を受け取った場合の挙動をテストで固定したい、なぜなら現在この組み合わせは`opfsNotApplicable`判定が`opfsDone`優先で常に`false`になり、`opfsChecking`/`opfsWarn`も両方`false`のまま「Done」表示になるが、この挙動がテストでカバーされておらず、将来レガシーDB削除ロジックの実装順序が変わった際に「削除失敗を検知できないままDone表示され続ける」事故に気づけないため。

## 優先度
- 順位: 03 / 4
- RICEスコア: 3.2（Reach=開発者(月数回の変更頻度) × Impact=0.5 × Confidence=80% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み（diagnosticsPanel.ts:291,302で矛盾入力時の判定ロジックを確認）。純粋なテスト追加で実装コストは最小だが、望ましい表示仕様を先に決める必要がありConfidenceはやや低い。依存関係なし。

## 制約
- `deriveMigrationStatus`の既存ロジック自体は変更しない（このPBIはテスト追加が主目的。仕様として「矛盾状態でも現状のDone表示のままでよい」と判断されれば、その判断をコメントとテストで明示するに留める）
- 表示内容・DOM構造は変更しない

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS移行済みかつレガシーDBが検出された場合の現状挙動をテストで固定する
  Given sqlite.opfsMigrationV2Done が true
  And sqlite.opfsLegacyDbPath が null 以外の値
  When deriveMigrationStatus(sqlite) を呼び出す
  Then opfs.done が true、opfs.notApplicable が false、opfs.warn が false として返される（現状仕様の固定）

Scenario: 矛盾状態が意図的な仕様であることがコードコメントで明示される
  Given 上記の矛盾入力パターン
  When deriveMigrationStatus のソースを読む
  Then 「done優先でnotApplicable判定はスキップされる」という設計判断がコメントとして残っている
```

## 受け入れ基準
- [ ] `deriveMigrationStatus.test.ts`に`opfsDone=true`かつ`opfsLegacyDbPath`非nullの組み合わせのテストケースを追加する
- [ ] このテストが固定する挙動（Done優先表示）が意図的な仕様か、それとも修正すべき不整合かをチームで判断し、記録を残す
- [ ] 仕様として現状維持と判断された場合は、`deriveMigrationStatus`の該当ロジック（`opfsNotApplicable`算出部分）に一言コメントを追加する

## テスト戦略
- E2E: なし（純粋関数の単体テストで十分）
- 統合: なし
- 単体: `opfsDone=true`かつ`opfsLegacyDbPath`非null、および同様の`idbDone`側の矛盾パターンを`deriveMigrationStatus.test.ts`に追加

## 見積もり
1ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
