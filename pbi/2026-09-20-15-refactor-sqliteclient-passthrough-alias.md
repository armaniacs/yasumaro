# PBI: SqliteClient パススルークラスを OffscreenGateway の alias に畳む

## ユーザーストーリー
開発者として、SQLite アクセスの overload 表面を1実装にしたい、なぜなら SqliteClient は OffscreenGateway の全面 overload を1行委譲で再掲するだけで、op 追加のたびに2クラスの同調更新を強要し価値を提供しないから

## 優先度
- 順位: 4 / 5
- RICEスコア: 3.2（Reach=2 / Impact=0.5 / Confidence=80% / Effort=0.25週）
- 根拠: shared Rust crate 抽出と同点(3.2)だが、リスク軽減効果で劣る tie-break。純機械的・低リスクで、空いた時間に消化する

## ビジネス価値
op 追加時の overload 同調更新箇所が2クラス→1クラスになる。deletion test が完全に失敗する(消しても振る舞いが1行も変わらない)モジュールを除去し、interface と test surface を一致させる

## BDD受け入れシナリオ

```gherkin
Scenario: SqliteClient 型が実体を失う
  Given SqliteClient を型として参照する ~20 呼び出し元
  When 参照を SqliteRpcClient interface / OffscreenGateway に張り替える
  Then 全テストが無変更で green であり、振る舞いは1行も変わらない

Scenario: op 追加時の更新箇所が減る
  Given 新しい mutate op を追加する
  When overload を書く場所を確認する
  Then OffscreenGateway(または interface)の1箇所のみである
```

## 受け入れ基準
- [ ] `SqliteClient` 具象クラスが削除され、`SqliteGateway = OffscreenGateway` と同型の alias または直接参照に置き換わる
- [ ] 呼び出し元は `SqliteRpcClient` interface(test surface)を型として使う
- [ ] op 追加時の overload 二重所有が解消される
- [ ] 既存テストの期待値変更なし

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- 既存の録画パイプライン・SQLite 経路テストが無変更で green

### 単体テスト
- 型レベルの検証(同期 assert・type-check)で担保。新規テスト不要

## 実装アプローチ
- **Red-Green-Refactor 不要**の機械的リネーム。type-check と既存 suite で検証

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。PBI 16(wire table 拡張)に着手するなら、その前に潰すと差分が読みやすくなる
- 非機能要件: 振る舞い変更ゼロ

## 実装者向け注記

### 現状の証拠
- `src/background/sqlite/offscreenGateway.ts:222-258` — query×5 / mutate×6 / maintain×16 / status の1行委譲 overload + キャスト(:229,235,255)
- 正直な版が同ファイル既存: `export const SqliteGateway = OffscreenGateway`(:217)
- 呼び出し元: `createSqliteClientDeps` 経由が `SqliteRpcClient` interface のみを必要とする。`RecordingOrchestrator`・pipeline steps・migration・wiring が `SqliteClient | null` 型
